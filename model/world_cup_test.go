package model

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withWorldCupTestSettings(t *testing.T) {
	t.Helper()

	originalQuotaPerUnit := common.QuotaPerUnit
	common.OptionMapRWMutex.Lock()
	originalOptionMap := common.OptionMap
	common.OptionMap = map[string]string{
		"WorldCupStreakBonusThreshold": "5",
		"WorldCupStreakBonusQuota":     "50",
	}
	common.OptionMapRWMutex.Unlock()

	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
		common.OptionMapRWMutex.Lock()
		common.OptionMap = originalOptionMap
		common.OptionMapRWMutex.Unlock()
	})

	common.QuotaPerUnit = 100
}

func insertWorldCupUserWithSubscription(t *testing.T, userId int, totalAmount int64, startTime int64, days int64) {
	t.Helper()

	require.NoError(t, DB.Create(&User{
		Id:       userId,
		Username: fmt.Sprintf("world_cup_user_%d", userId),
		Status:   common.UserStatusEnabled,
		Quota:    0,
		AffCode:  fmt.Sprintf("world_cup_%d", userId),
	}).Error)

	plan := &SubscriptionPlan{
		Id:            userId,
		Title:         "世界杯-月卡",
		PriceAmount:   10,
		PriceCNY:      70,
		Currency:      "USD",
		DurationUnit:  SubscriptionDurationDay,
		DurationValue: int(days),
		Enabled:       true,
		TotalAmount:   totalAmount,
	}
	require.NoError(t, DB.Create(plan).Error)

	require.NoError(t, DB.Create(&UserSubscription{
		UserId:              userId,
		PlanId:              plan.Id,
		AmountTotal:         totalAmount,
		StartTime:           startTime,
		EndTime:             startTime + days*24*3600,
		Status:              "active",
		Source:              "admin",
		AllowWalletOverflow: true,
	}).Error)
}

func worldCupSnapshot(matchId string, matchTime int64) WorldCupMatchSnapshot {
	return WorldCupMatchSnapshot{
		MatchId:       matchId,
		MatchDate:     time.Unix(matchTime, 0).In(WorldCupLocation()).Format("2006-01-02"),
		MatchTime:     matchTime,
		MatchType:     "1",
		GroupName:     "A",
		HostTeamId:    matchId + "-host",
		HostTeamName:  "Host " + matchId,
		GuestTeamId:   matchId + "-guest",
		GuestTeamName: "Guest " + matchId,
	}
}

func placeWorldCupPredictionForTest(t *testing.T, userId int, matchId string, matchTime int64, choice string) *WorldCupPrediction {
	t.Helper()

	prediction, err := PlaceWorldCupPrediction(userId, choice, worldCupSnapshot(matchId, matchTime), "127.0.0.1", matchTime-2*3600)
	require.NoError(t, err)
	return prediction
}

func settleWorldCupHostWinForTest(t *testing.T, matchId string, matchTime int64) {
	t.Helper()

	won, lost, err := SettleWorldCupPredictions(WorldCupMatchOutcome{
		MatchId:    matchId,
		MatchDate:  time.Unix(matchTime, 0).In(WorldCupLocation()).Format("2006-01-02"),
		Choice:     WorldCupChoiceHost,
		HostScore:  2,
		GuestScore: 1,
	})
	require.NoError(t, err)
	assert.Equal(t, 1, won)
	assert.Equal(t, 0, lost)
}

func getWorldCupPredictionForTest(t *testing.T, id int64) WorldCupPrediction {
	t.Helper()

	var prediction WorldCupPrediction
	require.NoError(t, DB.Where("id = ?", id).First(&prediction).Error)
	return prediction
}

func getWorldCupPredictionByMatchForTest(t *testing.T, matchId string) WorldCupPrediction {
	t.Helper()

	var prediction WorldCupPrediction
	require.NoError(t, DB.Where("match_id = ?", matchId).First(&prediction).Error)
	return prediction
}

func getWorldCupUserQuotaForTest(t *testing.T, userId int) int {
	t.Helper()

	var quota int
	require.NoError(t, DB.Model(&User{}).Where("id = ?", userId).Select("quota").Scan(&quota).Error)
	return quota
}

func TestHasWorldCupSubscriptionMatchesActiveWorldCupPlan(t *testing.T) {
	truncateTables(t)
	withWorldCupTestSettings(t)

	now := time.Now().Unix()
	insertWorldCupUserWithSubscription(t, 3101, 3000, now-3600, 30)

	eligible, summaries, err := HasWorldCupSubscription(3101)

	require.NoError(t, err)
	assert.True(t, eligible)
	require.Len(t, summaries, 1)
	assert.Equal(t, "世界杯-月卡", summaries[0].PlanTitle)
}

func TestWorldCupPredictionRewardUsesPackageDailyFormula(t *testing.T) {
	truncateTables(t)
	withWorldCupTestSettings(t)

	now := time.Now().Unix()
	insertWorldCupUserWithSubscription(t, 3201, 3650, now-3600, 30)

	rewardQuota, err := WorldCupPredictionRewardQuotaForUserAt(3201, now)

	require.NoError(t, err)
	assert.Equal(t, 12, rewardQuota)
}

func TestPlaceWorldCupPredictionValidatesProductRules(t *testing.T) {
	truncateTables(t)
	withWorldCupTestSettings(t)

	now := time.Now().Unix()
	insertWorldCupUserWithSubscription(t, 3301, 3000, now-3600, 30)
	matchTime := now + 3*3600

	prediction, err := PlaceWorldCupPrediction(3301, WorldCupChoiceHost, worldCupSnapshot("rule-match-1", matchTime), "127.0.0.1", now)
	require.NoError(t, err)
	assert.Equal(t, WorldCupChoiceHost, prediction.Choice)

	_, err = PlaceWorldCupPrediction(3301, WorldCupChoiceGuest, worldCupSnapshot("rule-match-1", matchTime), "127.0.0.1", now)
	require.ErrorContains(t, err, "已竞猜")

	nonGroup := worldCupSnapshot("rule-match-2", matchTime)
	nonGroup.MatchType = "2"
	prediction, err = PlaceWorldCupPrediction(3301, WorldCupChoiceHost, nonGroup, "127.0.0.1", now)
	require.NoError(t, err)
	assert.Equal(t, "2", prediction.MatchType)

	_, err = PlaceWorldCupPrediction(3301, WorldCupChoiceHost, worldCupSnapshot("rule-match-3", matchTime), "127.0.0.1", matchTime-3600)
	require.ErrorContains(t, err, "1 小时")
}

func TestSettleWorldCupPredictionsRewardsWinnerAndMarksLoser(t *testing.T) {
	truncateTables(t)
	withWorldCupTestSettings(t)

	now := time.Now().Unix()
	insertWorldCupUserWithSubscription(t, 3401, 3000, now-3600, 30)
	insertWorldCupUserWithSubscription(t, 3402, 3000, now-3600, 30)
	matchTime := now + 4*3600
	winner := placeWorldCupPredictionForTest(t, 3401, "settle-match", matchTime, WorldCupChoiceHost)
	loser := placeWorldCupPredictionForTest(t, 3402, "settle-match", matchTime, WorldCupChoiceGuest)

	won, lost, err := SettleWorldCupPredictions(WorldCupMatchOutcome{
		MatchId:    "settle-match",
		MatchDate:  winner.MatchDate,
		Choice:     WorldCupChoiceHost,
		HostScore:  1,
		GuestScore: 0,
	})

	require.NoError(t, err)
	assert.Equal(t, 1, won)
	assert.Equal(t, 1, lost)

	winnerRow := getWorldCupPredictionForTest(t, winner.Id)
	loserRow := getWorldCupPredictionForTest(t, loser.Id)
	assert.Equal(t, WorldCupPredictionWon, winnerRow.Status)
	assert.Equal(t, 10, winnerRow.RewardQuota)
	assert.Equal(t, 0, winnerRow.StreakBonusQuota)
	assert.Equal(t, 10, getWorldCupUserQuotaForTest(t, 3401))
	assert.Equal(t, WorldCupPredictionLost, loserRow.Status)
	assert.Equal(t, 0, loserRow.RewardQuota)
	assert.Equal(t, 0, getWorldCupUserQuotaForTest(t, 3402))
}

func TestSettleWorldCupPredictionsAddsStreakBonusOnFifthConsecutiveWin(t *testing.T) {
	truncateTables(t)
	withWorldCupTestSettings(t)

	now := time.Now().Unix()
	insertWorldCupUserWithSubscription(t, 3501, 3000, now-3600, 30)
	var fifth *WorldCupPrediction
	for i := 1; i <= 5; i++ {
		matchTime := now + int64(i)*3*3600
		matchId := fmt.Sprintf("streak-match-%d", i)
		fifth = placeWorldCupPredictionForTest(t, 3501, matchId, matchTime, WorldCupChoiceHost)
		settleWorldCupHostWinForTest(t, matchId, matchTime)
	}

	fifthRow := getWorldCupPredictionForTest(t, fifth.Id)
	assert.Equal(t, WorldCupPredictionWon, fifthRow.Status)
	assert.Equal(t, 50, fifthRow.StreakBonusQuota)
	assert.Equal(t, 10, fifthRow.RewardQuota)
	assert.Equal(t, 100, getWorldCupUserQuotaForTest(t, 3501))
}

func TestSettleWorldCupPredictionsUsesCurrentWinCounterForStreakBonus(t *testing.T) {
	truncateTables(t)
	withWorldCupTestSettings(t)

	now := time.Now().Unix()
	insertWorldCupUserWithSubscription(t, 3551, 3000, now-3600, 30)
	matchTimes := map[string]int64{
		"counter-match-1": now + 1*3*3600,
		"counter-match-3": now + 3*3*3600,
		"counter-match-5": now + 5*3*3600,
		"counter-match-7": now + 7*3*3600,
		"counter-match-9": now + 9*3*3600,
	}
	for matchId := range matchTimes {
		placeWorldCupPredictionForTest(t, 3551, matchId, matchTimes[matchId], WorldCupChoiceHost)
	}

	settleOrder := []string{
		"counter-match-3",
		"counter-match-5",
		"counter-match-7",
		"counter-match-9",
	}
	for _, matchId := range settleOrder {
		settleWorldCupHostWinForTest(t, matchId, matchTimes[matchId])
	}
	fourthWin := getWorldCupPredictionByMatchForTest(t, "counter-match-9")
	assert.Equal(t, WorldCupPredictionWon, fourthWin.Status)
	assert.Equal(t, 0, fourthWin.StreakBonusQuota)
	assert.Equal(t, 40, getWorldCupUserQuotaForTest(t, 3551))

	settleWorldCupHostWinForTest(t, "counter-match-1", matchTimes["counter-match-1"])

	fifthWin := getWorldCupPredictionByMatchForTest(t, "counter-match-1")
	assert.Equal(t, WorldCupPredictionWon, fifthWin.Status)
	assert.Equal(t, 50, fifthWin.StreakBonusQuota)
	assert.Equal(t, 10, fifthWin.RewardQuota)
	assert.Equal(t, 100, getWorldCupUserQuotaForTest(t, 3551))

	var streakCount int64
	require.NoError(t, DB.Model(&WorldCupPredictionStreak{}).Where("user_id = ?", 3551).Count(&streakCount).Error)
	assert.Equal(t, int64(5), streakCount)
}

func TestSettleWorldCupPredictionsResetsStreakAfterLoss(t *testing.T) {
	truncateTables(t)
	withWorldCupTestSettings(t)

	now := time.Now().Unix()
	insertWorldCupUserWithSubscription(t, 3601, 3000, now-3600, 30)
	for i := 1; i <= 4; i++ {
		matchTime := now + int64(i)*3*3600
		matchId := fmt.Sprintf("reset-win-%d", i)
		placeWorldCupPredictionForTest(t, 3601, matchId, matchTime, WorldCupChoiceHost)
		settleWorldCupHostWinForTest(t, matchId, matchTime)
	}

	lostTime := now + 5*3*3600
	lost := placeWorldCupPredictionForTest(t, 3601, "reset-loss", lostTime, WorldCupChoiceGuest)
	won, lostCount, err := SettleWorldCupPredictions(WorldCupMatchOutcome{
		MatchId:    "reset-loss",
		MatchDate:  lost.MatchDate,
		Choice:     WorldCupChoiceHost,
		HostScore:  1,
		GuestScore: 0,
	})
	require.NoError(t, err)
	assert.Equal(t, 0, won)
	assert.Equal(t, 1, lostCount)

	afterLossTime := now + 6*3*3600
	afterLoss := placeWorldCupPredictionForTest(t, 3601, "reset-after-loss", afterLossTime, WorldCupChoiceHost)
	settleWorldCupHostWinForTest(t, "reset-after-loss", afterLossTime)
	afterLossRow := getWorldCupPredictionForTest(t, afterLoss.Id)

	assert.Equal(t, 0, afterLossRow.StreakBonusQuota)
	assert.Equal(t, 10, afterLossRow.RewardQuota)
	assert.Equal(t, 50, getWorldCupUserQuotaForTest(t, 3601))

	var streakCount int64
	require.NoError(t, DB.Model(&WorldCupPredictionStreak{}).Where("user_id = ?", 3601).Count(&streakCount).Error)
	assert.Equal(t, int64(1), streakCount)
}
