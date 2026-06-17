package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

// LuckyBagStatus 返回当前用户参与资格、今日已用次数、奖金区间、档位表
func LuckyBagStatus(c *gin.Context) {
	userId := c.GetInt("id")

	eligibleSlots := model.GetUserDailyEligibility(userId)
	usedSlots := model.GetUserTodayUsedSlots(userId)
	remainingSlots := eligibleSlots - usedSlots
	if remainingSlots < 0 {
		remainingSlots = 0
	}
	yesterdaySpend := model.GetUserYesterdaySpendQuota(userId)
	todayWon := model.GetUserTodayWonQuota(userId)
	dailyLimitReached := todayWon >= model.LuckyBagDailyWonLimit

	minQ, maxQ := model.GetPrizeRange()

	common.ApiSuccess(c, gin.H{
		"eligibility": gin.H{
			"yesterday_spend_quota": yesterdaySpend,
			"eligible_slots":        eligibleSlots,
			"used_slots":            usedSlots,
			"remaining_slots":       remainingSlots,
			"today_won_quota":       todayWon,
			"daily_won_limit_quota": model.LuckyBagDailyWonLimit,
			"daily_limit_reached":   dailyLimitReached,
			"next_refresh_unix":     model.NextRefreshUnix(),
		},
		"prize_range": gin.H{
			"min_quota": minQ,
			"max_quota": maxQ,
		},
		"tiers": model.EligibilityTiers,
	})
}

// OpenLuckyBag 用户主动开盒
func OpenLuckyBag(c *gin.Context) {
	userId := c.GetInt("id")
	ip := c.ClientIP()

	prize, err := model.OpenLuckyBag(userId, ip)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	// 返回最新状态供前端立刻刷新
	usedSlots := model.GetUserTodayUsedSlots(userId)
	eligibleSlots := model.GetUserDailyEligibility(userId)
	remainingSlots := eligibleSlots - usedSlots
	if remainingSlots < 0 {
		remainingSlots = 0
	}
	todayWon := model.GetUserTodayWonQuota(userId)

	common.ApiSuccess(c, gin.H{
		"prize_quota":         prize,
		"today_won_quota":     todayWon,
		"used_slots":          usedSlots,
		"remaining_slots":     remainingSlots,
		"daily_limit_reached": todayWon >= model.LuckyBagDailyWonLimit,
	})
}

// LuckyBagHistory 用户开盒历史（默认最近 30 条）
func LuckyBagHistory(c *gin.Context) {
	userId := c.GetInt("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "30"))

	rows, total, err := model.GetLuckyBagOpenHistory(userId, page, size)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"records": rows,
		"total":   total,
		"page":    page,
		"size":    size,
	})
}
