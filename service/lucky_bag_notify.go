package service

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
)

const (
	luckyBagLLMEndpoint     = "https://aicloudroute.com/v1/chat/completions"
	luckyBagLLMModel        = "gpt-5.5"
	luckyBagMinUsd          = 9.9 // 最低档位（与 model.EligibilityTiers 兜底一致）
	luckyBagSendCooldownKey = "lucky_bag:notify:cooldown"
	luckyBagSendCooldown    = 60 * time.Second // 全局发送冷却：1分钟最多1条
)

// cstLoc 复用同一个 Location 对象，避免每次调用都分配
var cstLoc = time.FixedZone("CST", 8*3600)

// redisNotifyKey 幂等键：每个用户每天每个档位只通知一次
// key 格式：lucky_bag:notify:{userId}:{todayCST}:{slots}
func redisNotifyKey(userId int, slots int) string {
	today := time.Now().In(cstLoc).Format("20060102")
	return fmt.Sprintf("lucky_bag:notify:%d:%s:%d", userId, today, slots)
}

// matchSlotsByTier 按 model.EligibilityTiers（高→低排序）匹配当前消费应得的抽奖次数
func matchSlotsByTier(spendQuota int64) int {
	for _, tier := range model.EligibilityTiers {
		if float64(spendQuota) >= tier.MinUsd*500000 {
			return tier.Slots
		}
	}
	return 0
}

// TriggerLuckyBagNotify 在消费日志写入后异步调用。
// quota 为本次新增消费 quota（正整数）。
// 内部判断今日累计消费是否刚越过某个档位，若是则发微信群通知。
func TriggerLuckyBagNotify(userId int, quota int) {
	defer func() {
		if r := recover(); r != nil {
			logger.LogWarn(context.Background(), fmt.Sprintf("[LuckyBagNotify] panic recovered userId=%d: %v", userId, r))
		}
	}()

	if quota <= 0 {
		return
	}

	// Redis 是幂等的硬依赖；未启用时直接跳过，避免 nil RDB panic 与重复轰炸
	if !common.RedisEnabled || common.RDB == nil {
		return
	}

	ctx := context.Background()

	// 快速前置过滤：当前窗口累计消费是否已经超过最低档门槛
	todaySpend := model.GetUserWindowSpendQuota(userId)
	if float64(todaySpend) < luckyBagMinUsd*500000 {
		return
	}

	currentSlots := matchSlotsByTier(todaySpend)
	if currentSlots == 0 {
		return
	}

	// Redis 幂等检查：该档位今天是否已通知过
	key := redisNotifyKey(userId, currentSlots)
	if val, err := common.RedisGet(key); err == nil && val != "" {
		return
	}

	// 写幂等键（TTL 2天，防跨日误判）。写失败不发通知，避免重复轰炸
	if err := common.RedisSet(key, "1", 48*time.Hour); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBagNotify] RedisSet failed, skip notify userId=%d slots=%d: %v", userId, currentSlots, err))
		return
	}

	// 获取用户名
	username, err := model.GetUsernameById(userId, false)
	if err != nil || username == "" {
		username = fmt.Sprintf("用户%d", userId)
	}

	// 异步发通知（包内 helper 提供 panic recover）
	asyncSafe(func() {
		spendUSD := float64(todaySpend) / 500000.0
		if err := sendLuckyBagEligibleNotify(ctx, username, spendUSD, currentSlots); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("[LuckyBagNotify] send failed userId=%d slots=%d: %v", userId, currentSlots, err))
		} else {
			logger.LogInfo(ctx, fmt.Sprintf("[LuckyBagNotify] sent userId=%d username=%s slots=%d spendUSD=%.2f", userId, username, currentSlots, spendUSD))
		}
	})
}

// asyncSafe 起一个带 panic recover 的 goroutine，避免 LLM/HTTP 异常导致进程崩溃
func asyncSafe(fn func()) {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				logger.LogWarn(context.Background(), fmt.Sprintf("[LuckyBagNotify] async panic recovered: %v", r))
			}
		}()
		fn()
	}()
}

// sendLuckyBagEligibleNotify 拼消息并发送到微信群
func sendLuckyBagEligibleNotify(ctx context.Context, username string, spendUSD float64, slots int) error {
	// 全局发送限流：1 分钟最多 1 条，窗口期内直接丢弃（不入队、不补发）
	// 用 SETNX + TTL 实现：抢到 key 才发，抢不到说明 60s 内已发过
	if !acquireSendCooldown() {
		logger.LogInfo(ctx, fmt.Sprintf("[LuckyBagNotify] dropped by cooldown username=%s slots=%d", username, slots))
		return nil
	}

	// 给 LLM 调用单独设 90s 超时。已在 asyncSafe goroutine 里，等多久不阻塞主流程。
	llmCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	// 并行调用两个 LLM，总耗时 = max(opening, blessing)，而非串行相加
	type stringResult struct{ val string }
	openingCh := make(chan stringResult, 1)
	blessingCh := make(chan stringResult, 1)

	go func() {
		openingCh <- stringResult{generateOpening(llmCtx)}
	}()
	go func() {
		blessingCh <- stringResult{generateBlessing(llmCtx, username, spendUSD, slots)}
	}()

	opening := (<-openingCh).val
	blessing := (<-blessingCh).val

	msg := fmt.Sprintf("%s\n\n用户：%s\n今日消费：$%.2f\n今日抽奖次数：%d 次\n\n%s\n\n快登录平台前往抽奖页面领取～",
		opening, username, spendUSD, slots, blessing)

	return SendWechatGroupMessage(msg)
}

// acquireSendCooldown 抢全局冷却锁。true=抢到，可以发；false=已被占用，应丢弃。
// 服务重启后 Redis 中的 key 仍在 TTL 内，自然继续生效，避免重启疯狂补发。
func acquireSendCooldown() bool {
	if !common.RedisEnabled || common.RDB == nil {
		// 没有 Redis 时不限流（兜底允许发送，避免完全没消息）
		return true
	}
	ok, err := common.RDB.SetNX(context.Background(), luckyBagSendCooldownKey, "1", luckyBagSendCooldown).Result()
	if err != nil {
		// Redis 异常时保守放行，避免因为限流挂了导致一条都发不出
		logger.LogWarn(context.Background(), fmt.Sprintf("[LuckyBagNotify] cooldown SetNX err: %v", err))
		return true
	}
	return ok
}

// openingFallbacks 兜底候选池。LLM 失效或被命中黑名单时随机抽用，保证多样性。
var openingFallbacks = []string{
	"少壮不搬砖，老大徒伤悲",
	"打工是不可能打工的，这辈子都不可能",
	"上班如上坟，工资是寿衣",
	"摸鱼一时爽，工资火葬场",
	"你不努力一下，都不知道什么叫绝望",
	"打工人的快乐，往往就是这么简单",
	"福报已到账，请查收人间疾苦",
	"今日份的精神状态：在线营业",
	"卷又卷不动，躺又躺不平",
	"周一吃苦周二吃苦周三吃苦周四吃苦周五吃苦周六不吃苦周日不吃苦",
}

// openingBlocklist LLM 输出里要踢掉的高频"模板套话"。匹配则视为低质回退。
var openingBlocklist = []string{
	"天生我材必",
	"君不见黄河之水",
	"少壮不努力", // 让兜底版本独占改编位
	"莫等闲、白了少年头",
}

// openingDirections 多个方向轮换塞进 prompt，避免"魔改古诗"被首选偏置反复命中。
var openingDirections = [][]string{
	{"佛系打工金句", "魔改名人名言", "网络段子改编", "鸡汤反讽"},
	{"打工人吐槽段子", "互联网黑话改编", "魔改广告语", "佛系金句"},
	{"反鸡汤金句", "打工版谚语改造", "网友神评论", "魔改流行歌词"},
	{"赛博丧文学", "现代诗式吐槽", "脱口秀风格金句", "网络梗改编"},
}

// generateOpening 调用 LLM 生成激励打工人的金句开头，失败/低质则从候选池随机回退。
func generateOpening(ctx context.Context) string {
	dir := openingDirections[rand.Intn(len(openingDirections))]
	rand.Shuffle(len(dir), func(i, j int) { dir[i], dir[j] = dir[j], dir[i] })
	prompt := fmt.Sprintf(
		"生成一句激励/调侃打工人的开头语，从以下方向选一个：%s。"+
			"硬性要求：1) 不超过20字 2) 必须原创，禁止套用「天生我材」「君不见黄河」「少壮不努力」等高频古诗句式 3) 风格幽默接地气、有自嘲感 4) 直接输出一句话，不要解释、不要引号、不要标号。",
		strings.Join(dir, "、"),
	)
	result, err := callLLMWithParams(ctx, "", prompt, 80, 1.1)
	cleaned := strings.TrimSpace(result)
	if err != nil || cleaned == "" || hitBlocklist(cleaned, openingBlocklist) {
		return openingFallbacks[rand.Intn(len(openingFallbacks))]
	}
	return cleaned
}

// hitBlocklist 命中任意黑名单关键字则返回 true。
func hitBlocklist(s string, list []string) bool {
	for _, kw := range list {
		if strings.Contains(s, kw) {
			return true
		}
	}
	return false
}

// generateBlessing 调用 LLM 生成谄媚祝福话术，失败则返回默认值
func generateBlessing(ctx context.Context, username string, spendUSD float64, slots int) string {
	userPrompt := fmt.Sprintf("用户「%s」今日在AI平台消费达到 $%.2f，现在已获得 %d 次福袋抽奖资格，请生成一段祝福提醒话术。", username, spendUSD, slots)
	systemPrompt := "你是一个调皮谄媚的福袋小助手，管用户叫爸爸。生成一句话的祝福，风格口语化、接地气、像朋友发微信一样自然，不要太AI腔，最多用1个emoji，不超过30字，直接输出内容。"
	result, err := callLLMWithSystem(ctx, systemPrompt, userPrompt, 100)
	if err != nil || strings.TrimSpace(result) == "" {
		return fmt.Sprintf("%s爸爸今天消费给力，福袋现在就可以抽！", username)
	}
	return strings.TrimSpace(result)
}

// callLLM 调用外部 LLM 接口（无 system prompt，默认 temperature 1.0）
func callLLM(ctx context.Context, userPrompt string, maxTokens int) (string, error) {
	return callLLMWithParams(ctx, "", userPrompt, maxTokens, 1.0)
}

// callLLMWithSystem 调用外部 LLM 接口（默认 temperature 1.0）
func callLLMWithSystem(ctx context.Context, systemPrompt, userPrompt string, maxTokens int) (string, error) {
	return callLLMWithParams(ctx, systemPrompt, userPrompt, maxTokens, 1.0)
}

// callLLMWithParams 调用外部 LLM 接口，可显式指定 temperature 控制多样性。
func callLLMWithParams(ctx context.Context, systemPrompt, userPrompt string, maxTokens int, temperature float64) (string, error) {
	apiKey := getLLMConfig()
	if apiKey == "" {
		return "", fmt.Errorf("LuckyBagLLMApiKey not configured")
	}

	messages := make([]map[string]string, 0, 2)
	if systemPrompt != "" {
		messages = append(messages, map[string]string{"role": "system", "content": systemPrompt})
	}
	messages = append(messages, map[string]string{"role": "user", "content": userPrompt})

	body, err := common.Marshal(map[string]any{
		"model":       luckyBagLLMModel,
		"messages":    messages,
		"max_tokens":  maxTokens,
		"temperature": temperature,
	})
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", luckyBagLLMEndpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := common.Unmarshal(respBody, &result); err != nil {
		return "", err
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("empty choices from LLM")
	}
	return result.Choices[0].Message.Content, nil
}

// getLLMConfig 从 OptionMap 读取 LLM API Key，配置项名：LuckyBagLLMApiKey
func getLLMConfig() string {
	if common.OptionMap == nil {
		return ""
	}
	common.OptionMapRWMutex.RLock()
	key := common.OptionMap["LuckyBagLLMApiKey"]
	common.OptionMapRWMutex.RUnlock()
	return strings.TrimSpace(key)
}
