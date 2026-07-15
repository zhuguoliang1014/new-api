package operation_setting

import "github.com/QuantumNous/new-api/setting/config"

const (
	ChannelHealthMetricTotalCount     = "total_count"
	ChannelHealthMetricRequestCount   = "request_count"
	ChannelHealthMetricSuccessCount   = "success_count"
	ChannelHealthMetricErrorCount     = "error_count"
	ChannelHealthMetricErrorRate      = "error_rate"
	ChannelHealthMetricSuccessRate    = "success_rate"
	ChannelHealthMetricAvgTtftMs      = "avg_ttft_ms"
	ChannelHealthMetricP50TtftMs      = "p50_ttft_ms"
	ChannelHealthMetricP95TtftMs      = "p95_ttft_ms"
	ChannelHealthMetricMaxTtftMs      = "max_ttft_ms"
	ChannelHealthMetricAvgLatencyMs   = "avg_latency_ms"
	ChannelHealthMetricP50LatencyMs   = "p50_latency_ms"
	ChannelHealthMetricP95LatencyMs   = "p95_latency_ms"
	ChannelHealthMetricMaxLatencyMs   = "max_latency_ms"
	channelHealthDefaultWechatGroupID = "57047022764@chatroom"
)

type ChannelHealthAlertSetting struct {
	Enabled              bool                     `json:"enabled"`
	CheckIntervalSeconds int                      `json:"check_interval_seconds"`
	WechatGroupIds       string                   `json:"wechat_group_ids"`
	Rules                []ChannelHealthAlertRule `json:"rules"`
}

type ChannelHealthAlertRule struct {
	ID              string                      `json:"id"`
	Name            string                      `json:"name"`
	Enabled         bool                        `json:"enabled"`
	WindowMinutes   int                         `json:"window_minutes"`
	CooldownMinutes int                         `json:"cooldown_minutes"`
	Scope           ChannelHealthAlertScope     `json:"scope"`
	Condition       ChannelHealthAlertCondition `json:"condition"`
}

type ChannelHealthAlertScope struct {
	ChannelIds []int    `json:"channel_ids,omitempty"`
	Models     []string `json:"models,omitempty"`
	Groups     []string `json:"groups,omitempty"`
}

type ChannelHealthAlertCondition struct {
	And    []ChannelHealthAlertCondition `json:"and,omitempty"`
	Or     []ChannelHealthAlertCondition `json:"or,omitempty"`
	Metric string                        `json:"metric,omitempty"`
	Op     string                        `json:"op,omitempty"`
	Value  float64                       `json:"value,omitempty"`
}

var channelHealthAlertSetting = ChannelHealthAlertSetting{
	Enabled:              false,
	CheckIntervalSeconds: 60,
	WechatGroupIds:       channelHealthDefaultWechatGroupID,
	Rules: []ChannelHealthAlertRule{
		{
			ID:              "high_error_rate",
			Name:            "错误率过高",
			Enabled:         true,
			WindowMinutes:   5,
			CooldownMinutes: 15,
			Condition: ChannelHealthAlertCondition{And: []ChannelHealthAlertCondition{
				{Metric: ChannelHealthMetricTotalCount, Op: ">=", Value: 10},
				{Metric: ChannelHealthMetricErrorCount, Op: ">=", Value: 5},
				{Metric: ChannelHealthMetricErrorRate, Op: ">=", Value: 50},
			}},
		},
		{
			ID:              "high_latency",
			Name:            "延迟过高",
			Enabled:         true,
			WindowMinutes:   5,
			CooldownMinutes: 15,
			Condition: ChannelHealthAlertCondition{And: []ChannelHealthAlertCondition{
				{Metric: ChannelHealthMetricSuccessCount, Op: ">=", Value: 10},
				{Or: []ChannelHealthAlertCondition{
					{Metric: ChannelHealthMetricP50TtftMs, Op: ">=", Value: 8000},
					{Metric: ChannelHealthMetricP50LatencyMs, Op: ">=", Value: 60000},
				}},
			}},
		},
	},
}

func init() {
	config.GlobalConfig.Register("channel_health_alert_setting", &channelHealthAlertSetting)
}

func GetChannelHealthAlertSetting() ChannelHealthAlertSetting {
	setting := channelHealthAlertSetting
	if setting.CheckIntervalSeconds < 15 {
		setting.CheckIntervalSeconds = 15
	}
	if setting.WechatGroupIds == "" {
		setting.WechatGroupIds = channelHealthDefaultWechatGroupID
	}
	return setting
}
