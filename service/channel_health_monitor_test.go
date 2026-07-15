package service

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestChannelHealthConditionEvaluation(t *testing.T) {
	condition := operation_setting.ChannelHealthAlertCondition{And: []operation_setting.ChannelHealthAlertCondition{
		{Metric: operation_setting.ChannelHealthMetricTotalCount, Op: ">=", Value: 10},
		{Or: []operation_setting.ChannelHealthAlertCondition{
			{Metric: operation_setting.ChannelHealthMetricErrorCount, Op: ">=", Value: 5},
			{Metric: operation_setting.ChannelHealthMetricErrorRate, Op: ">=", Value: 50},
		}},
	}}

	assert.True(t, evaluateChannelHealthCondition(condition, map[string]float64{
		operation_setting.ChannelHealthMetricTotalCount: 12,
		operation_setting.ChannelHealthMetricErrorCount: 4,
		operation_setting.ChannelHealthMetricErrorRate:  50,
	}))
	assert.False(t, evaluateChannelHealthCondition(condition, map[string]float64{
		operation_setting.ChannelHealthMetricTotalCount: 9,
		operation_setting.ChannelHealthMetricErrorCount: 9,
		operation_setting.ChannelHealthMetricErrorRate:  100,
	}))
	assert.False(t, evaluateChannelHealthCondition(condition, map[string]float64{
		operation_setting.ChannelHealthMetricTotalCount: 12,
		operation_setting.ChannelHealthMetricErrorCount: 4,
		operation_setting.ChannelHealthMetricErrorRate:  40,
	}))
}

func TestAggregateChannelHealthStatsRespectsScopeAndWindow(t *testing.T) {
	now := time.Unix(1000, 0)
	other, err := common.Marshal(map[string]any{
		"frt":        1200,
		"latency_ms": 9000,
	})
	require.NoError(t, err)

	rule := operation_setting.ChannelHealthAlertRule{
		WindowMinutes: 5,
		Scope: operation_setting.ChannelHealthAlertScope{
			ChannelIds: []int{7},
			Models:     []string{"gpt-4o"},
			Groups:     []string{"vip"},
		},
	}
	statsByChannel := aggregateChannelHealthStats([]model.ChannelHealthLogSample{
		{CreatedAt: now.Add(-time.Minute).Unix(), ChannelId: 7, Type: model.LogTypeConsume, ModelName: "gpt-4o", Group: "vip", Other: string(other)},
		{CreatedAt: now.Add(-time.Minute).Unix(), ChannelId: 7, Type: model.LogTypeError, ModelName: "gpt-4o", Group: "vip"},
		{CreatedAt: now.Add(-time.Minute).Unix(), ChannelId: 8, Type: model.LogTypeError, ModelName: "gpt-4o", Group: "vip"},
		{CreatedAt: now.Add(-10 * time.Minute).Unix(), ChannelId: 7, Type: model.LogTypeError, ModelName: "gpt-4o", Group: "vip"},
		{CreatedAt: now.Add(-time.Minute).Unix(), ChannelId: 7, Type: model.LogTypeError, ModelName: "claude", Group: "vip"},
	}, rule, now)

	stats, ok := statsByChannel[7]
	require.True(t, ok)
	assert.Equal(t, 2, stats.TotalCount)
	assert.Equal(t, 1, stats.SuccessCount)
	assert.Equal(t, 1, stats.ErrorCount)

	metrics := channelHealthMetrics(stats)
	assert.Equal(t, 50.0, metrics[operation_setting.ChannelHealthMetricErrorRate])
	assert.Equal(t, 1200.0, metrics[operation_setting.ChannelHealthMetricAvgTtftMs])
	assert.Equal(t, 1200.0, metrics[operation_setting.ChannelHealthMetricP50TtftMs])
	assert.Equal(t, 9000.0, metrics[operation_setting.ChannelHealthMetricAvgLatencyMs])
	assert.Equal(t, 9000.0, metrics[operation_setting.ChannelHealthMetricP50LatencyMs])
	assert.NotContains(t, statsByChannel, 8)
}

func TestChannelHealthAlertMessageOnlyShowsTriggeredMetrics(t *testing.T) {
	rule := operation_setting.ChannelHealthAlertRule{
		Name:            "延迟过高",
		WindowMinutes:   30,
		CooldownMinutes: 30,
		Condition: operation_setting.ChannelHealthAlertCondition{And: []operation_setting.ChannelHealthAlertCondition{
			{Metric: operation_setting.ChannelHealthMetricSuccessCount, Op: ">=", Value: 10},
			{Or: []operation_setting.ChannelHealthAlertCondition{
				{Metric: operation_setting.ChannelHealthMetricP50TtftMs, Op: ">=", Value: 10000},
				{Metric: operation_setting.ChannelHealthMetricP50LatencyMs, Op: ">=", Value: 20000},
			}},
		}},
	}
	message := channelHealthAlertMessage([]channelHealthAlert{{
		Rule: rule,
		Stats: channelHealthStats{
			ChannelID:     47,
			ChannelName:   "sub-gpt-普通号池",
			SuccessCount:  26,
			TtftValues:    []float64{1000, 2000, 3000},
			LatencyValues: []float64{15000, 22000, 24000},
		},
	}})

	assert.Contains(t, message, "#47 sub-gpt-普通号池")
	assert.Contains(t, message, "成功 26（≥10）")
	assert.Contains(t, message, "总延迟 P50 22000ms（≥20000ms）")
	assert.NotContains(t, message, "均值")
	assert.NotContains(t, message, "P95")
	assert.NotContains(t, message, "首字 P50")
}

func TestChannelHealthP50IgnoresSparseLatencyOutliers(t *testing.T) {
	stats := channelHealthStats{
		SuccessCount: 10,
		TotalCount:   10,
		TtftValues: []float64{
			1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 540000, 540000,
		},
		LatencyValues: []float64{
			2000, 2000, 2000, 2000, 2000, 2000, 2000, 2000, 550000, 550000,
		},
	}

	metrics := channelHealthMetrics(stats)
	assert.Equal(t, 1000.0, metrics[operation_setting.ChannelHealthMetricP50TtftMs])
	assert.Equal(t, 2000.0, metrics[operation_setting.ChannelHealthMetricP50LatencyMs])
	assert.Equal(t, 540000.0, metrics[operation_setting.ChannelHealthMetricP95TtftMs])
	assert.Equal(t, 550000.0, metrics[operation_setting.ChannelHealthMetricP95LatencyMs])

	condition := operation_setting.ChannelHealthAlertCondition{Or: []operation_setting.ChannelHealthAlertCondition{
		{Metric: operation_setting.ChannelHealthMetricP50TtftMs, Op: ">=", Value: 8000},
		{Metric: operation_setting.ChannelHealthMetricP50LatencyMs, Op: ">=", Value: 60000},
	}}
	assert.False(t, evaluateChannelHealthCondition(condition, metrics))
}

func TestChannelHealthCooldownIsSharedByRule(t *testing.T) {
	redisEnabled := common.RedisEnabled
	common.RedisEnabled = false
	defer func() {
		common.RedisEnabled = redisEnabled
		channelHealthMemoryCooldown.Lock()
		channelHealthMemoryCooldown.items = map[string]time.Time{}
		channelHealthMemoryCooldown.Unlock()
	}()

	channelHealthMemoryCooldown.Lock()
	channelHealthMemoryCooldown.items = map[string]time.Time{}
	channelHealthMemoryCooldown.Unlock()

	rule := operation_setting.ChannelHealthAlertRule{ID: "high_latency", CooldownMinutes: 15}
	assert.True(t, reserveChannelHealthCooldown(t.Context(), rule))
	assert.False(t, reserveChannelHealthCooldown(t.Context(), rule))
	assert.True(t, reserveChannelHealthCooldown(t.Context(), operation_setting.ChannelHealthAlertRule{
		ID:              "high_error_rate",
		CooldownMinutes: 15,
	}))
}
