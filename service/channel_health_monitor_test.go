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
	assert.Equal(t, 9000.0, metrics[operation_setting.ChannelHealthMetricAvgLatencyMs])
	assert.NotContains(t, statsByChannel, 8)
}
