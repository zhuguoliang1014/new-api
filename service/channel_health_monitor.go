package service

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

const channelHealthAlertMaxChannels = 10

type channelHealthStats struct {
	ChannelID     int
	ChannelName   string
	TotalCount    int
	SuccessCount  int
	ErrorCount    int
	TtftValues    []float64
	LatencyValues []float64
}

type channelHealthAlert struct {
	Rule  operation_setting.ChannelHealthAlertRule
	Stats channelHealthStats
}

var channelHealthMemoryCooldown = struct {
	sync.Mutex
	items map[string]time.Time
}{items: map[string]time.Time{}}

func RunChannelHealthMonitorOnce(ctx context.Context) (map[string]any, error) {
	setting := operation_setting.GetChannelHealthAlertSetting()
	if !setting.Enabled {
		return map[string]any{"enabled": false}, nil
	}

	rules := enabledChannelHealthRules(setting.Rules)
	if len(rules) == 0 {
		return map[string]any{"enabled": true, "rules": 0}, nil
	}

	maxWindowMinutes := maxChannelHealthWindowMinutes(rules)
	now := time.Now()
	samples, err := model.FindChannelHealthLogSamples(now.Add(-time.Duration(maxWindowMinutes)*time.Minute).Unix(), now.Unix())
	if err != nil {
		return nil, err
	}

	alerts := make([]channelHealthAlert, 0)
	for _, rule := range rules {
		statsByChannel := aggregateChannelHealthStats(samples, rule, now)
		ruleAlerts := make([]channelHealthAlert, 0)
		for _, stats := range statsByChannel {
			if evaluateChannelHealthCondition(rule.Condition, channelHealthMetrics(stats)) {
				ruleAlerts = append(ruleAlerts, channelHealthAlert{Rule: rule, Stats: stats})
			}
		}
		if len(ruleAlerts) > 0 && reserveChannelHealthCooldown(ctx, rule) {
			alerts = append(alerts, ruleAlerts...)
		}
	}

	if len(alerts) > 0 {
		attachChannelNames(alerts)
		sendChannelHealthAlerts(ctx, setting.WechatGroupIds, alerts)
	}

	return map[string]any{
		"enabled":        true,
		"rules":          len(rules),
		"samples":        len(samples),
		"alerts_sent":    len(alerts),
		"window_minutes": maxWindowMinutes,
	}, nil
}

func enabledChannelHealthRules(rules []operation_setting.ChannelHealthAlertRule) []operation_setting.ChannelHealthAlertRule {
	enabled := make([]operation_setting.ChannelHealthAlertRule, 0, len(rules))
	for _, rule := range rules {
		if !rule.Enabled || rule.ID == "" {
			continue
		}
		if rule.WindowMinutes <= 0 {
			rule.WindowMinutes = 5
		}
		if rule.CooldownMinutes <= 0 {
			rule.CooldownMinutes = 15
		}
		if strings.TrimSpace(rule.Name) == "" {
			rule.Name = rule.ID
		}
		enabled = append(enabled, rule)
	}
	return enabled
}

func maxChannelHealthWindowMinutes(rules []operation_setting.ChannelHealthAlertRule) int {
	maxWindow := 5
	for _, rule := range rules {
		if rule.WindowMinutes > maxWindow {
			maxWindow = rule.WindowMinutes
		}
	}
	return maxWindow
}

func aggregateChannelHealthStats(samples []model.ChannelHealthLogSample, rule operation_setting.ChannelHealthAlertRule, now time.Time) map[int]channelHealthStats {
	startTimestamp := now.Add(-time.Duration(rule.WindowMinutes) * time.Minute).Unix()
	statsByChannel := map[int]channelHealthStats{}
	for _, sample := range samples {
		if sample.CreatedAt < startTimestamp || !channelHealthScopeMatches(rule.Scope, sample) {
			continue
		}
		stats := statsByChannel[sample.ChannelId]
		stats.ChannelID = sample.ChannelId
		stats.TotalCount++
		switch sample.Type {
		case model.LogTypeError:
			stats.ErrorCount++
		case model.LogTypeConsume:
			stats.SuccessCount++
			appendLatencyValues(&stats, sample)
		}
		statsByChannel[sample.ChannelId] = stats
	}
	return statsByChannel
}

func channelHealthScopeMatches(scope operation_setting.ChannelHealthAlertScope, sample model.ChannelHealthLogSample) bool {
	if len(scope.ChannelIds) > 0 && !intSliceContains(scope.ChannelIds, sample.ChannelId) {
		return false
	}
	if len(scope.Models) > 0 && !stringSliceContains(scope.Models, sample.ModelName) {
		return false
	}
	if len(scope.Groups) > 0 && !stringSliceContains(scope.Groups, sample.Group) {
		return false
	}
	return true
}

func appendLatencyValues(stats *channelHealthStats, sample model.ChannelHealthLogSample) {
	if sample.Other != "" {
		other, err := common.StrToMap(sample.Other)
		if err == nil {
			if ttftMs, ok := mapNumber(other, "frt"); ok && ttftMs >= 0 {
				stats.TtftValues = append(stats.TtftValues, ttftMs)
			}
			if latencyMs, ok := mapNumber(other, "latency_ms"); ok && latencyMs >= 0 {
				stats.LatencyValues = append(stats.LatencyValues, latencyMs)
				return
			}
		}
	}
	if sample.UseTime > 0 {
		stats.LatencyValues = append(stats.LatencyValues, float64(sample.UseTime*1000))
	}
}

func mapNumber(values map[string]interface{}, key string) (float64, bool) {
	value, ok := values[key]
	if !ok {
		return 0, false
	}
	switch typed := value.(type) {
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return 0, false
		}
		return typed, true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	default:
		return 0, false
	}
}

func channelHealthMetrics(stats channelHealthStats) map[string]float64 {
	errorRate := 0.0
	successRate := 0.0
	if stats.TotalCount > 0 {
		errorRate = float64(stats.ErrorCount) / float64(stats.TotalCount) * 100
		successRate = float64(stats.SuccessCount) / float64(stats.TotalCount) * 100
	}
	return map[string]float64{
		operation_setting.ChannelHealthMetricTotalCount:   float64(stats.TotalCount),
		operation_setting.ChannelHealthMetricRequestCount: float64(stats.TotalCount),
		operation_setting.ChannelHealthMetricSuccessCount: float64(stats.SuccessCount),
		operation_setting.ChannelHealthMetricErrorCount:   float64(stats.ErrorCount),
		operation_setting.ChannelHealthMetricErrorRate:    errorRate,
		operation_setting.ChannelHealthMetricSuccessRate:  successRate,
		operation_setting.ChannelHealthMetricAvgTtftMs:    avgFloat(stats.TtftValues),
		operation_setting.ChannelHealthMetricP50TtftMs:    percentileFloat(stats.TtftValues, 0.50),
		operation_setting.ChannelHealthMetricP95TtftMs:    percentileFloat(stats.TtftValues, 0.95),
		operation_setting.ChannelHealthMetricMaxTtftMs:    maxFloat(stats.TtftValues),
		operation_setting.ChannelHealthMetricAvgLatencyMs: avgFloat(stats.LatencyValues),
		operation_setting.ChannelHealthMetricP50LatencyMs: percentileFloat(stats.LatencyValues, 0.50),
		operation_setting.ChannelHealthMetricP95LatencyMs: percentileFloat(stats.LatencyValues, 0.95),
		operation_setting.ChannelHealthMetricMaxLatencyMs: maxFloat(stats.LatencyValues),
	}
}

func evaluateChannelHealthCondition(condition operation_setting.ChannelHealthAlertCondition, metrics map[string]float64) bool {
	if len(condition.And) > 0 {
		for _, child := range condition.And {
			if !evaluateChannelHealthCondition(child, metrics) {
				return false
			}
		}
		return true
	}
	if len(condition.Or) > 0 {
		for _, child := range condition.Or {
			if evaluateChannelHealthCondition(child, metrics) {
				return true
			}
		}
		return false
	}
	actual, ok := metrics[condition.Metric]
	if !ok {
		return false
	}
	switch condition.Op {
	case ">":
		return actual > condition.Value
	case ">=":
		return actual >= condition.Value
	case "<":
		return actual < condition.Value
	case "<=":
		return actual <= condition.Value
	case "=", "==":
		return actual == condition.Value
	case "!=":
		return actual != condition.Value
	default:
		return false
	}
}

func reserveChannelHealthCooldown(ctx context.Context, rule operation_setting.ChannelHealthAlertRule) bool {
	cooldown := time.Duration(rule.CooldownMinutes) * time.Minute
	if cooldown <= 0 {
		cooldown = 15 * time.Minute
	}
	key := fmt.Sprintf("channel_health_alert:%s", rule.ID)
	if common.RedisEnabled && common.RDB != nil {
		ok, err := common.RDB.SetNX(ctx, key, "1", cooldown).Result()
		if err == nil {
			return ok
		}
		logger.LogWarn(ctx, fmt.Sprintf("channel health alert cooldown redis failed: %v", err))
	}

	now := time.Now()
	channelHealthMemoryCooldown.Lock()
	defer channelHealthMemoryCooldown.Unlock()
	if nextAt, ok := channelHealthMemoryCooldown.items[key]; ok && now.Before(nextAt) {
		return false
	}
	channelHealthMemoryCooldown.items[key] = now.Add(cooldown)
	for itemKey, nextAt := range channelHealthMemoryCooldown.items {
		if now.After(nextAt) {
			delete(channelHealthMemoryCooldown.items, itemKey)
		}
	}
	return true
}

func attachChannelNames(alerts []channelHealthAlert) {
	channelIDs := make([]int, 0, len(alerts))
	seen := map[int]struct{}{}
	for _, alert := range alerts {
		if _, ok := seen[alert.Stats.ChannelID]; ok {
			continue
		}
		seen[alert.Stats.ChannelID] = struct{}{}
		channelIDs = append(channelIDs, alert.Stats.ChannelID)
	}
	names, err := model.GetChannelNamesByIDs(channelIDs)
	if err != nil {
		logger.LogWarn(context.Background(), fmt.Sprintf("channel health alert channel lookup failed: %v", err))
		return
	}
	for i := range alerts {
		alerts[i].Stats.ChannelName = names[alerts[i].Stats.ChannelID]
	}
}

func sendChannelHealthAlerts(ctx context.Context, groupIDs string, alerts []channelHealthAlert) {
	alertsByRule := map[string][]channelHealthAlert{}
	ruleOrder := make([]string, 0)
	for _, alert := range alerts {
		if _, ok := alertsByRule[alert.Rule.ID]; !ok {
			ruleOrder = append(ruleOrder, alert.Rule.ID)
		}
		alertsByRule[alert.Rule.ID] = append(alertsByRule[alert.Rule.ID], alert)
	}
	for _, ruleID := range ruleOrder {
		ruleAlerts := alertsByRule[ruleID]
		sort.Slice(ruleAlerts, func(i, j int) bool {
			left := channelHealthMetrics(ruleAlerts[i].Stats)
			right := channelHealthMetrics(ruleAlerts[j].Stats)
			return left[operation_setting.ChannelHealthMetricErrorRate]+left[operation_setting.ChannelHealthMetricAvgLatencyMs]/1000 >
				right[operation_setting.ChannelHealthMetricErrorRate]+right[operation_setting.ChannelHealthMetricAvgLatencyMs]/1000
		})
		message := channelHealthAlertMessage(ruleAlerts)
		if err := SendWechatGroupMessageToGroups(message, groupIDs); err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("channel health alert wechat send failed: %v", err))
		}
	}
}

func channelHealthAlertMessage(alerts []channelHealthAlert) string {
	if len(alerts) == 0 {
		return ""
	}
	rule := alerts[0].Rule
	lines := []string{
		"渠道健康报警：" + rule.Name,
		fmt.Sprintf("窗口：最近 %d 分钟", rule.WindowMinutes),
		fmt.Sprintf("冷却：%d 分钟", rule.CooldownMinutes),
	}
	limit := len(alerts)
	if limit > channelHealthAlertMaxChannels {
		limit = channelHealthAlertMaxChannels
	}
	for _, alert := range alerts[:limit] {
		stats := alert.Stats
		metrics := channelHealthMetrics(stats)
		name := stats.ChannelName
		if name == "" {
			name = "未知渠道"
		}
		lines = append(lines, fmt.Sprintf(
			"#%d %s｜请求 %.0f｜成功 %.0f｜错误 %.0f｜错误率 %.1f%%｜首字 均值/P50/P95 %.0f/%.0f/%.0fms｜总延迟 均值/P50/P95 %.0f/%.0f/%.0fms",
			stats.ChannelID,
			name,
			metrics[operation_setting.ChannelHealthMetricTotalCount],
			metrics[operation_setting.ChannelHealthMetricSuccessCount],
			metrics[operation_setting.ChannelHealthMetricErrorCount],
			metrics[operation_setting.ChannelHealthMetricErrorRate],
			metrics[operation_setting.ChannelHealthMetricAvgTtftMs],
			metrics[operation_setting.ChannelHealthMetricP50TtftMs],
			metrics[operation_setting.ChannelHealthMetricP95TtftMs],
			metrics[operation_setting.ChannelHealthMetricAvgLatencyMs],
			metrics[operation_setting.ChannelHealthMetricP50LatencyMs],
			metrics[operation_setting.ChannelHealthMetricP95LatencyMs],
		))
	}
	if len(alerts) > limit {
		lines = append(lines, fmt.Sprintf("另有 %d 个渠道也触发该规则", len(alerts)-limit))
	}
	return strings.Join(lines, "\n")
}

func avgFloat(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	total := 0.0
	for _, value := range values {
		total += value
	}
	return total / float64(len(values))
}

func maxFloat(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	maxValue := values[0]
	for _, value := range values[1:] {
		if value > maxValue {
			maxValue = value
		}
	}
	return maxValue
}

func percentileFloat(values []float64, percentile float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	index := int(math.Ceil(float64(len(sorted))*percentile)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func intSliceContains(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func stringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == target {
			return true
		}
	}
	return false
}
