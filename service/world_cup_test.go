package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func resetWorldCupScheduleCacheForTest(t *testing.T) {
	worldCupScheduleCacheMu.Lock()
	worldCupScheduleCache = map[string]worldCupScheduleMemoryEntry{}
	worldCupScheduleCacheMu.Unlock()

	worldCupScheduleDailyLimitMu.Lock()
	worldCupScheduleDailyLimitDay = ""
	worldCupScheduleDailyLimitCount = 0
	worldCupScheduleDailyLimitMu.Unlock()

	redisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	t.Cleanup(func() {
		common.RedisEnabled = redisEnabled
	})
}

func withWorldCupServiceTestSettings(t *testing.T) {
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

func TestFetchWorldCupScheduleDoesNotDefaultType(t *testing.T) {
	resetWorldCupScheduleCacheForTest(t)

	observedType := "not called"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedType = r.URL.Query().Get("type")
		assert.Equal(t, "test-key", r.URL.Query().Get("key"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"reason":"success","resultcode":"200","error_code":0,"result":{"data":[]}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("WORLD_CUP_SCHEDULE_URL", server.URL)
	t.Setenv("WORLD_CUP_API_KEY", "test-key")

	result, err := FetchWorldCupSchedule(context.Background(), WorldCupScheduleQuery{})

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Empty(t, observedType)
}

func TestFetchWorldCupScheduleUsesStaleCacheAfterDailyLimit(t *testing.T) {
	resetWorldCupScheduleCacheForTest(t)

	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"reason":"success","resultcode":"200","error_code":0,"result":{"data":[{"schedule_date":"2026-06-27","schedule_list":[]}]}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("WORLD_CUP_SCHEDULE_URL", server.URL)
	t.Setenv("WORLD_CUP_API_KEY", "test-key")
	t.Setenv("WORLD_CUP_SCHEDULE_DAILY_REQUEST_LIMIT", "1")

	result, err := FetchWorldCupSchedule(context.Background(), WorldCupScheduleQuery{})
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, 1, callCount)

	worldCupScheduleCacheMu.Lock()
	for key, entry := range worldCupScheduleCache {
		entry.ExpiresAt = time.Now().Add(-time.Minute).Unix()
		worldCupScheduleCache[key] = entry
	}
	worldCupScheduleCacheMu.Unlock()

	result, err = FetchWorldCupSchedule(context.Background(), WorldCupScheduleQuery{})
	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, 1, callCount)
	assert.Len(t, result.Data, 1)
}

func TestFetchWorldCupScheduleDateQueryReusesFullScheduleCache(t *testing.T) {
	resetWorldCupScheduleCacheForTest(t)

	callCount := 0
	observedDates := make([]string, 0)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		observedDates = append(observedDates, r.URL.Query().Get("date"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"reason":"success","resultcode":"200","error_code":0,"result":{"data":[{"schedule_date":"2026-06-27","schedule_list":[{"team_id":"match-1","date":"2026-06-27","date_time":"2026-06-27 20:00:00"}]},{"schedule_date":"2026-06-28","schedule_list":[{"team_id":"match-2","date":"2026-06-28","date_time":"2026-06-28 20:00:00"}]}]}}`))
	}))
	t.Cleanup(server.Close)
	t.Setenv("WORLD_CUP_SCHEDULE_URL", server.URL)
	t.Setenv("WORLD_CUP_API_KEY", "test-key")

	result, err := FetchWorldCupSchedule(context.Background(), WorldCupScheduleQuery{})
	require.NoError(t, err)
	require.Len(t, result.Data, 2)

	result, err = FetchWorldCupSchedule(context.Background(), WorldCupScheduleQuery{Date: "2026-06-28"})
	require.NoError(t, err)
	require.Len(t, result.Data, 1)
	require.Len(t, result.Data[0].ScheduleList, 1)
	assert.Equal(t, "match-2", result.Data[0].ScheduleList[0].MatchId())
	assert.Equal(t, 1, callCount)
	assert.Equal(t, []string{""}, observedDates)
}

func TestSettleWorldCupPredictionsFromScheduleRewardsCompletedMatch(t *testing.T) {
	truncate(t)
	withWorldCupServiceTestSettings(t)

	now := time.Now().Unix()
	require.NoError(t, model.DB.Create(&model.User{
		Id:       9401,
		Username: "world_cup_service_user",
		Status:   common.UserStatusEnabled,
		Quota:    0,
		AffCode:  "world_cup_service_user",
	}).Error)
	require.NoError(t, model.DB.Create(&model.SubscriptionPlan{
		Id:            9401,
		Title:         "世界杯-月卡",
		PriceAmount:   10,
		PriceCNY:      70,
		Currency:      "USD",
		DurationUnit:  model.SubscriptionDurationDay,
		DurationValue: 30,
		Enabled:       true,
		TotalAmount:   3000,
	}).Error)
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		UserId:              9401,
		PlanId:              9401,
		AmountTotal:         3000,
		StartTime:           now - 3600,
		EndTime:             now - 3600 + 30*24*3600,
		Status:              "active",
		Source:              "admin",
		AllowWalletOverflow: true,
	}).Error)
	require.NoError(t, model.DB.Create(&model.WorldCupPrediction{
		UserId:        9401,
		MatchId:       "fresh-settle-match",
		MatchDate:     "2026-06-28",
		MatchTime:     now - 3600,
		MatchType:     "1",
		GroupName:     "A",
		HostTeamName:  "美国",
		GuestTeamName: "墨西哥",
		Choice:        model.WorldCupChoiceHost,
		Status:        model.WorldCupPredictionPending,
	}).Error)

	settleWorldCupPredictionsFromSchedule(context.Background(), &WorldCupScheduleResult{
		Data: []WorldCupScheduleDay{
			{
				ScheduleDate: "2026-06-28",
				ScheduleList: []WorldCupMatch{
					{
						TeamId:               "fresh-settle-match",
						Date:                 "2026-06-28",
						HostTeamName:         "美国",
						GuestTeamName:        "墨西哥",
						HostTeamScore:        "2",
						GuestTeamScore:       "0",
						MatchStatus:          "3",
						MatchDescription:     "已完赛",
						MatchType:            "1",
						MatchTypeDescription: "小组赛",
						GroupName:            "A",
					},
				},
			},
		},
	})

	var prediction model.WorldCupPrediction
	require.NoError(t, model.DB.Where("match_id = ?", "fresh-settle-match").First(&prediction).Error)
	assert.Equal(t, model.WorldCupPredictionWon, prediction.Status)
	assert.Equal(t, 10, prediction.RewardQuota)

	var user model.User
	require.NoError(t, model.DB.Where("id = ?", 9401).First(&user).Error)
	assert.Equal(t, 10, user.Quota)
}

func TestSettleWorldCupPredictionsFromScheduleDoesNotDependOnScheduleOrderForStreakBonus(t *testing.T) {
	truncate(t)
	withWorldCupServiceTestSettings(t)

	now := time.Now().Unix()
	require.NoError(t, model.DB.Create(&model.User{
		Id:       9501,
		Username: "world_cup_streak_service_user",
		Status:   common.UserStatusEnabled,
		Quota:    0,
		AffCode:  "world_cup_streak_service_user",
	}).Error)
	require.NoError(t, model.DB.Create(&model.SubscriptionPlan{
		Id:            9501,
		Title:         "世界杯-月卡",
		PriceAmount:   10,
		PriceCNY:      70,
		Currency:      "USD",
		DurationUnit:  model.SubscriptionDurationDay,
		DurationValue: 30,
		Enabled:       true,
		TotalAmount:   3000,
	}).Error)
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		UserId:              9501,
		PlanId:              9501,
		AmountTotal:         3000,
		StartTime:           now - 3600,
		EndTime:             now - 3600 + 30*24*3600,
		Status:              "active",
		Source:              "admin",
		AllowWalletOverflow: true,
	}).Error)

	baseTime := time.Now().Add(24 * time.Hour).Unix()
	matches := make([]WorldCupMatch, 0, 5)
	for i := 1; i <= 5; i++ {
		matchTime := baseTime + int64(i)*3600
		dateTime := time.Unix(matchTime, 0).In(model.WorldCupLocation()).Format("2006-01-02 15:04:05")
		matchId := fmt.Sprintf("service-streak-match-%d", i)
		_, err := model.PlaceWorldCupPrediction(9501, model.WorldCupChoiceHost, model.WorldCupMatchSnapshot{
			MatchId:       matchId,
			MatchDate:     dateTime[:10],
			MatchTime:     matchTime,
			MatchType:     "1",
			GroupName:     "A",
			HostTeamName:  "美国",
			GuestTeamName: "墨西哥",
		}, "127.0.0.1", matchTime-2*3600)
		require.NoError(t, err)
		matches = append(matches, WorldCupMatch{
			TeamId:               matchId,
			Date:                 dateTime[:10],
			DateTime:             dateTime,
			HostTeamName:         "美国",
			GuestTeamName:        "墨西哥",
			HostTeamScore:        "2",
			GuestTeamScore:       "0",
			MatchStatus:          "3",
			MatchDescription:     "已完赛",
			MatchType:            "1",
			MatchTypeDescription: "小组赛",
			GroupName:            "A",
		})
	}
	reversed := []WorldCupMatch{matches[4], matches[3], matches[2], matches[1], matches[0]}

	settleWorldCupPredictionsFromSchedule(context.Background(), &WorldCupScheduleResult{
		Data: []WorldCupScheduleDay{{ScheduleList: reversed}},
	})

	var fifth model.WorldCupPrediction
	require.NoError(t, model.DB.Where("match_id = ?", "service-streak-match-5").First(&fifth).Error)
	assert.Equal(t, model.WorldCupPredictionWon, fifth.Status)
	assert.Equal(t, 50, fifth.StreakBonusQuota)
	assert.Equal(t, 10, fifth.RewardQuota)

	var user model.User
	require.NoError(t, model.DB.Where("id = ?", 9501).First(&user).Error)
	assert.Equal(t, 100, user.Quota)
}
