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
//   - 资格基于「昨日 type=2 真实 API 扣费」分档，映射到「今日机会次数」
//   - 每日机会刷新时刻：08:00 (UTC+8)
//   - 单次开盒 [$0.30, $2.00]（管理员可调），每次必中
//   - 奖金直接 IncreaseUserQuota 入余额，并写一条 LogTypeTopup
//   - 单人每日累计中奖 quota 上限 $10 (5,000,000 quota)
// ───────────────────────────────────────────────────────────────────────────

// 重要常量
const (
	// LuckyBagDailyWonLimit 单人每日累计中奖 quota 上限（$10）
	LuckyBagDailyWonLimit = 5000000
	// LuckyBagRefreshHour 每日机会刷新时刻（CST 小时）
	LuckyBagRefreshHour = 8
	// 默认奖金区间（quota 单位，500000 = $1）
	defaultPrizeMinQuota = 150000  // $0.30
	defaultPrizeMaxQuota = 1000000 // $2.00
)

// EligibilityTier 资格档位（昨日消费 quota → 今日机会数）
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

// dayWindowAt08 返回「以 08:00 (CST) 为日界」的当前所属窗口 [start, end)，单位：unix 秒
//
//	now ≥ 今日 08:00 → [今日 08:00, 明日 08:00)
//	now <  今日 08:00 → [昨日 08:00, 今日 08:00)
func dayWindowAt08(now time.Time) (start, end int64) {
	loc := cstLocation()
	t := now.In(loc)
	today8 := time.Date(t.Year(), t.Month(), t.Day(), LuckyBagRefreshHour, 0, 0, 0, loc)
	if t.Before(today8) {
		yesterday8 := today8.AddDate(0, 0, -1)
		return yesterday8.Unix(), today8.Unix()
	}
	tomorrow8 := today8.AddDate(0, 0, 1)
	return today8.Unix(), tomorrow8.Unix()
}

// NextRefreshUnix 返回下一次资格刷新时刻（08:00 CST）的 unix 秒
func NextRefreshUnix() int64 {
	_, end := dayWindowAt08(time.Now())
	return end
}

// yesterdayCalendarWindow 返回昨日（CST 自然日）的 [start, end)
//
//	无论现在几点，"昨日" 总是指上一个完整自然日 00:00 ~ 24:00
func yesterdayCalendarWindow(now time.Time) (start, end int64) {
	loc := cstLocation()
	t := now.In(loc)
	todayStart := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, loc)
	yesterdayStart := todayStart.AddDate(0, 0, -1)
	return yesterdayStart.Unix(), todayStart.Unix()
}

// GetUserYesterdaySpendQuota 返回用户昨日（CST 自然日）type=2 的 quota 扣费总和
func GetUserYesterdaySpendQuota(userId int) int64 {
	yStart, yEnd := yesterdayCalendarWindow(time.Now())
	type sumRow struct{ Total int64 }
	var row sumRow
	DB.Model(&Log{}).
		Select("COALESCE(SUM(quota), 0) AS total").
		Where("user_id = ? AND type = 2 AND created_at >= ? AND created_at < ?",
			userId, yStart, yEnd).
		Scan(&row)
	return row.Total
}

// GetUserDailyEligibility 返回用户今日机会数（0/1/2/3/5）
func GetUserDailyEligibility(userId int) int {
	spend := GetUserYesterdaySpendQuota(userId)
	for _, tier := range EligibilityTiers {
		if float64(spend) >= tier.MinUsd*500000 {
			return tier.Slots
		}
	}
	return 0
}

// GetUserTodayUsedSlots 返回当前刷新窗口内（今日 08:00 起）的开盒次数
func GetUserTodayUsedSlots(userId int) int {
	start, end := dayWindowAt08(time.Now())
	var count int64
	DB.Model(&LuckyBagOpen{}).
		Where("user_id = ? AND opened_at >= ? AND opened_at < ?", userId, start, end).
		Count(&count)
	return int(count)
}

// GetUserTodayWonQuota 返回当前刷新窗口内累计中奖 quota
func GetUserTodayWonQuota(userId int) int64 {
	start, end := dayWindowAt08(time.Now())
	type sumRow struct{ Total int64 }
	var row sumRow
	DB.Model(&LuckyBagOpen{}).
		Select("COALESCE(SUM(prize_quota), 0) AS total").
		Where("user_id = ? AND opened_at >= ? AND opened_at < ?", userId, start, end).
		Scan(&row)
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

// OpenLuckyBag 执行一次开盒
//   - 校验三层资格：消费门槛 / 今日次数 / 每日上限
//   - 抽奖、写记录、加余额、写 Topup 日志
//   - 若已达上限，会精确截断本次奖金到 limit-won 之间，避免越权
func OpenLuckyBag(userId int, ip string) (prizeQuota int, err error) {
	ctx := context.Background()

	// ── 资格层1：昨日消费门槛 ────────────────────────────────────────
	eligible := GetUserDailyEligibility(userId)
	if eligible == 0 {
		return 0, errors.New("昨日真实消费不足 $9.9，暂无参与资格")
	}

	// ── 资格层2：今日次数 ────────────────────────────────────────────
	used := GetUserTodayUsedSlots(userId)
	if used >= eligible {
		return 0, errors.New("今日机会已用完")
	}

	// ── 资格层3：每日中奖上限 $10 ────────────────────────────────────
	won := GetUserTodayWonQuota(userId)
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

	// 加余额
	if err := IncreaseUserQuota(userId, prize, true); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] OpenLuckyBag userId=%d IncreaseUserQuota failed: %v", userId, err))
		return 0, errors.New("加余额失败，请重试")
	}

	// 写历史记录
	now := time.Now().Unix()
	rec := &LuckyBagOpen{
		UserId:     userId,
		PrizeQuota: prize,
		OpenedAt:   now,
		Ip:         ip,
	}
	if err := DB.Create(rec).Error; err != nil {
		// 历史写失败不阻塞用户拿到余额，但要打 warn
		logger.LogWarn(ctx, fmt.Sprintf("[LuckyBag] OpenLuckyBag userId=%d create record failed: %v", userId, err))
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
