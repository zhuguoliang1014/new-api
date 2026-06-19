package model

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
)

// ───────────────────────────────────────────────────────────────────────────
// 福袋盲盒（手动开盒、每次必中、奖金直接进余额）
//
// 业务模型：
//   - 资格基于「当日 type=2 真实 API 扣费」分档，映射到「当日机会次数」
//   - 每日机会刷新时刻：00:00 (UTC+8) 自然日切换
//   - 消费 / 开盒次数 / 中奖上限 共用同一个自然日窗口 [今日 00:00, 明日 00:00)
//   - 单次开盒 [$0.30, $2.00]（管理员可调），每次必中
//   - 奖金直接 IncreaseUserQuota 入余额，并写一条 LogTypeTopup
//   - 单人每日累计中奖 quota 上限 $10 (5,000,000 quota)
// ───────────────────────────────────────────────────────────────────────────

// 重要常量
const (
	// LuckyBagDailyWonLimit 单人每日累计中奖 quota 上限（$10）
	LuckyBagDailyWonLimit = 5000000
	// 默认奖金区间（quota 单位，500000 = $1）
	defaultPrizeMinQuota = 150000  // $0.30
	defaultPrizeMaxQuota = 1000000 // $2.00
)

// EligibilityTier 资格档位（今日消费 quota → 今日机会数）
type EligibilityTier struct {
	MinUsd float64 `json:"min_usd"`
	Slots  int     `json:"slots"`
}

// EligibilityTiers 资格档位（高 → 低 顺序），匹配第一个达标即返回
var EligibilityTiers = []EligibilityTier{
	{MinUsd: 99.9, Slots: 5},
	{MinUsd: 59.9, Slots: 3},
	{MinUsd: 29.9, Slots: 2},
	{MinUsd: 9.9, Slots: 1},
}

// LuckyBagOpen 用户开盒记录
type LuckyBagOpen struct {
	Id         int64  `json:"id" gorm:"primaryKey;autoIncrement"`
	UserId     int    `json:"user_id" gorm:"not null;index:idx_lbopen_user_time,priority:1"`
	PrizeQuota int    `json:"prize_quota" gorm:"not null"`
	OpenedAt   int64  `json:"opened_at" gorm:"not null;index:idx_lbopen_user_time,priority:2"`
	Ip         string `json:"-" gorm:"type:varchar(64)"`
}

// cstLocation 返回 UTC+8 时区
func cstLocation() *time.Location {
	return time.FixedZone("CST", 8*3600)
}

// calendarDayWindow 返回「CST 自然日」的当前所属窗口 [start, end)，单位：unix 秒
//
//	[今日 00:00, 明日 00:00)
//
// 资格消费 / 开盒次数 / 中奖上限 共用此窗口，确保不会跨窗口复用消费。
func calendarDayWindow(now time.Time) (start, end int64) {
	loc := cstLocation()
	t := now.In(loc)
	todayStart := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
	tomorrowStart := todayStart.AddDate(0, 0, 1)
	return todayStart.Unix(), tomorrowStart.Unix()
}

// NextRefreshUnix 返回下一次资格刷新时刻（明日 00:00 CST）的 unix 秒
func NextRefreshUnix() int64 {
	_, end := calendarDayWindow(time.Now())
	return end
}

// GetUserWindowSpendQuota 返回用户当前自然日窗口内的 type=2 quota 扣费总和。
// 与 GetUserTodayUsedSlots / GetUserTodayWonQuota 使用同一个窗口。
//
// 注：扣除同窗口内的退款（type=6），避免「消费 → 退款 → 仍享受档位」的资格漂白。
func GetUserWindowSpendQuota(userId int) int64 {
	start, end := calendarDayWindow(time.Now())
	return getUserWindowSpendQuotaIn(userId, start, end)
}

func getUserWindowSpendQuotaIn(userId int, start, end int64) int64 {
	type sumRow struct{ Total int64 }
	var consume, refund sumRow
	if err := DB.Model(&Log{}).
		Select("COALESCE(SUM(quota), 0) AS total").
		Where("user_id = ? AND type = ? AND created_at >= ? AND created_at < ?",
			userId, LogTypeConsume, start, end).
		Scan(&consume).Error; err != nil {
		logger.LogWarn(context.Background(),
			fmt.Sprintf("[LuckyBag] window spend(consume) query userId=%d err=%v", userId, err))
		return 0
	}
	if err := DB.Model(&Log{}).
		Select("COALESCE(SUM(quota), 0) AS total").
		Where("user_id = ? AND type = ? AND created_at >= ? AND created_at < ?",
			userId, LogTypeRefund, start, end).
		Scan(&refund).Error; err != nil {
		logger.LogWarn(context.Background(),
			fmt.Sprintf("[LuckyBag] window spend(refund) query userId=%d err=%v", userId, err))
		return consume.Total
	}
	net := consume.Total - refund.Total
	if net < 0 {
		net = 0
	}
	return net
}

// GetUserDailyEligibility 返回用户当前窗口内的机会数（0/1/2/3/5），基于当前自然日窗口消费
func GetUserDailyEligibility(userId int) int {
	spend := GetUserWindowSpendQuota(userId)
	return eligibilityFromSpend(spend)
}

func eligibilityFromSpend(spend int64) int {
	for _, tier := range EligibilityTiers {
		if float64(spend) >= tier.MinUsd*500000 {
			return tier.Slots
		}
	}
	return 0
}

// GetUserTodayUsedSlots 返回当前自然日窗口内的开盒次数
func GetUserTodayUsedSlots(userId int) int {
	start, end := calendarDayWindow(time.Now())
	return getUserUsedSlotsIn(userId, start, end)
}

func getUserUsedSlotsIn(userId int, start, end int64) int {
	var count int64
	if err := DB.Model(&LuckyBagOpen{}).
		Where("user_id = ? AND opened_at >= ? AND opened_at < ?", userId, start, end).
		Count(&count).Error; err != nil {
		logger.LogWarn(context.Background(),
			fmt.Sprintf("[LuckyBag] used slots query userId=%d err=%v", userId, err))
		return 0
	}
	return int(count)
}

// GetUserTodayWonQuota 返回当前自然日窗口内累计中奖 quota
func GetUserTodayWonQuota(userId int) int64 {
	start, end := calendarDayWindow(time.Now())
	return getUserWonQuotaIn(userId, start, end)
}

func getUserWonQuotaIn(userId int, start, end int64) int64 {
	type sumRow struct{ Total int64 }
	var row sumRow
	if err := DB.Model(&LuckyBagOpen{}).
		Select("COALESCE(SUM(prize_quota), 0) AS total").
		Where("user_id = ? AND opened_at >= ? AND opened_at < ?", userId, start, end).
		Scan(&row).Error; err != nil {
		logger.LogWarn(context.Background(),
			fmt.Sprintf("[LuckyBag] won quota query userId=%d err=%v", userId, err))
		return 0
	}
	return row.Total
}

// GetPrizeRange 返回当前奖金区间（quota 单位）。
// 优先读 OptionMap["LuckyBagMinUsd"] / ["LuckyBagMaxUsd"]（单位 USD）；
// 配置缺失或非法时回落到默认值。
func GetPrizeRange() (minQ, maxQ int) {
	minQ, maxQ = defaultPrizeMinQuota, defaultPrizeMaxQuota
	if common.OptionMap == nil {
		return
	}
	common.OptionMapRWMutex.RLock()
	minRaw := common.OptionMap["LuckyBagMinUsd"]
	maxRaw := common.OptionMap["LuckyBagMaxUsd"]
	common.OptionMapRWMutex.RUnlock()

	if v, err := strconv.ParseFloat(strings.TrimSpace(minRaw), 64); err == nil && v > 0 {
		minQ = int(v * 500000)
	}
	if v, err := strconv.ParseFloat(strings.TrimSpace(maxRaw), 64); err == nil && v > 0 {
		maxQ = int(v * 500000)
	}
	if maxQ < minQ {
		maxQ = minQ
	}
	return
}

// drawPrize 在 [minQ, maxQ] 区间内均匀随机生成一个奖金值
func drawPrize(minQ, maxQ int) int {
	if maxQ <= minQ {
		return minQ
	}
	return minQ + rand.Intn(maxQ-minQ+1)
}

// luckyBagOpenLockTTL 用户级互斥锁的 TTL；保证临界区在崩溃后不会永久卡住
const luckyBagOpenLockTTL = 5 * time.Second

// acquireOpenLock 抢用户级开盒互斥锁。Redis 不可用时降级为允许（依赖 DB 内部
// 一致性 + 上层限流），保持单 Redis 节点宕机时基本可用。
func acquireOpenLock(userId int) (release func(), ok bool) {
	if !common.RedisEnabled || common.RDB == nil {
		return func() {}, true
	}
	key := fmt.Sprintf("lucky_bag:open_lock:%d", userId)
	got, err := common.RDB.SetNX(context.Background(), key, "1", luckyBagOpenLockTTL).Result()
	if err != nil {
		logger.LogWarn(context.Background(),
			fmt.Sprintf("[LuckyBag] acquireOpenLock userId=%d SETNX err=%v, fallthrough", userId, err))
		return func() {}, true
	}
	if !got {
		return nil, false
	}
	return func() { _ = common.RedisDel(key) }, true
}

// OpenLuckyBag 执行一次开盒
//   - Redis 用户级互斥锁，杜绝并发 TOCTOU
//   - 同一时间快照 (now) 贯穿资格读取/记录写入，避免跨 00:00 漂移
//   - 先写 LuckyBagOpen（占坑），后加余额；若加余额失败回滚记录
//   - 若已达上限，会精确截断本次奖金到 limit-won 之间，避免越权
func OpenLuckyBag(userId int, ip string) (prizeQuota int, err error) {
	ctx := context.Background()

	// ── 互斥锁：同一用户同一时刻最多一个 OpenLuckyBag 在执行 ──────────
	release, ok := acquireOpenLock(userId)
	if !ok {
		return 0, errors.New("操作太频繁，请稍后再试")
	}
	defer release()

	// 同一时间快照贯穿整个临界区，防止跨 00:00 时窗口漂移
	now := time.Now()
	winStart, winEnd := calendarDayWindow(now)

	// ── 资格层1：今日消费门槛 ────────────────────────────────────────
	spend := getUserWindowSpendQuotaIn(userId, winStart, winEnd)
	eligible := eligibilityFromSpend(spend)
	if eligible == 0 {
		return 0, errors.New("今日真实消费不足 $9.9，暂无参与资格")
	}

	// ── 资格层2：今日次数 ────────────────────────────────────────────
	used := getUserUsedSlotsIn(userId, winStart, winEnd)
	if used >= eligible {
		return 0, errors.New("今日机会已用完")
	}

	// ── 资格层3：每日中奖上限 $10 ────────────────────────────────────
	won := getUserWonQuotaIn(userId, winStart, winEnd)
	if won >= LuckyBagDailyWonLimit {
		return 0, errors.New("今日已达领奖上限 $10")
	}

	// 抽奖
	minQ, maxQ := GetPrizeRange()
	prize := drawPrize(minQ, maxQ)

	// 不让单次开盒超过每日上限
	if won+int64(prize) > LuckyBagDailyWonLimit {
		prize = int(LuckyBagDailyWonLimit - won)
		if prize <= 0 {
			return 0, errors.New("今日已达领奖上限 $10")
		}
	}

	// 先写历史记录占坑（任何后续校验失败必须回滚此记录，否则会少计 used/won）
	rec := &LuckyBagOpen{
		UserId:     userId,
		PrizeQuota: prize,
		OpenedAt:   now.Unix(),
		Ip:         ip,
	}
	if err := DB.Create(rec).Error; err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] OpenLuckyBag userId=%d create record failed: %v", userId, err))
		return 0, errors.New("写记录失败，请重试")
	}

	// 加余额；失败则回滚记录避免「占了次数没拿到钱」
	if err := IncreaseUserQuota(userId, prize, true); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] OpenLuckyBag userId=%d IncreaseUserQuota failed: %v, rolling back record id=%d", userId, err, rec.Id))
		if delErr := DB.Delete(rec).Error; delErr != nil {
			logger.LogError(ctx, fmt.Sprintf("[LuckyBag] OpenLuckyBag userId=%d rollback record id=%d failed: %v (manual cleanup needed)", userId, rec.Id, delErr))
		}
		return 0, errors.New("加余额失败，请重试")
	}

	// 写 Topup Log
	RecordLog(userId, LogTypeTopup, fmt.Sprintf("福袋开盒奖励 %s", logQuotaForLog(prize)))

	logger.LogInfo(ctx, fmt.Sprintf("[LuckyBag] OpenLuckyBag userId=%d prize=%d won_total=%d used=%d/%d",
		userId, prize, won+int64(prize), used+1, eligible))
	return prize, nil
}

// logQuotaForLog 把 quota 数值格式化为 "$X.XX" 用于日志展示
func logQuotaForLog(quota int) string {
	return fmt.Sprintf("$%.2f", float64(quota)/500000.0)
}

// LuckyBagOpenRecord 历史开盒记录（API 返回结构）
type LuckyBagOpenRecord struct {
	Id         int64 `json:"id"`
	PrizeQuota int   `json:"prize_quota"`
	OpenedAt   int64 `json:"opened_at"`
}

// GetLuckyBagOpenHistory 返回用户最近的开盒记录（按时间倒序）
func GetLuckyBagOpenHistory(userId, page, size int) ([]LuckyBagOpenRecord, int64, error) {
	if size <= 0 {
		size = 30
	}
	if size > 100 {
		size = 100
	}
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * size

	var total int64
	if err := DB.Model(&LuckyBagOpen{}).Where("user_id = ?", userId).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []LuckyBagOpen
	if err := DB.Where("user_id = ?", userId).
		Order("opened_at desc").
		Offset(offset).Limit(size).
		Find(&rows).Error; err != nil {
		return nil, 0, err
	}
	out := make([]LuckyBagOpenRecord, len(rows))
	for i, r := range rows {
		out[i] = LuckyBagOpenRecord{Id: r.Id, PrizeQuota: r.PrizeQuota, OpenedAt: r.OpenedAt}
	}
	return out, total, nil
}
