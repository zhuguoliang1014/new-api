package model

import (
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

const DefaultSubscriptionGroup = "【新】GPT稳定号池"

// NormalizeSubscriptionGroups accepts only explicitly configured groups.
// nil means an older client/plan and defaults to the designated group; an
// explicit empty list is invalid, never an unrestricted subscription.
func NormalizeSubscriptionGroups(groups []string) ([]string, error) {
	if groups == nil {
		groups = []string{DefaultSubscriptionGroup}
	}
	if len(groups) == 0 {
		return nil, common.NewMessage("Select at least one subscription group")
	}
	normalized := make([]string, 0, len(groups))
	for _, group := range groups {
		group = strings.TrimSpace(group)
		if group == "" || group == "auto" || !ratio_setting.ContainsGroupRatio(group) {
			return nil, common.NewMessage("Subscription group does not exist")
		}
		if !slices.Contains(normalized, group) {
			normalized = append(normalized, group)
		}
	}
	return normalized, nil
}

func (p *SubscriptionPlan) EffectiveAllowedGroups() []string {
	if p.AllowedGroups == nil {
		return []string{DefaultSubscriptionGroup}
	}
	return p.AllowedGroups
}

func (p *SubscriptionPlan) AllowsGroup(group string) bool {
	return group != "" && group != "auto" && slices.Contains(p.EffectiveAllowedGroups(), group)
}

// Retain the rate of older generic plans while replacing their eligibility.
func (p *SubscriptionPlan) UsesPlanBillingRatio() bool {
	return len(p.AllowedGroups) > 0 || strings.TrimSpace(p.AllowedChannelTypes) != ""
}

// EffectiveBillingRatio preserves 1x billing for plans created before ratios were configurable.
func (p *SubscriptionPlan) EffectiveBillingRatio() (float64, error) {
	if p.BillingRatio == nil {
		return 1, nil
	}
	ratio := *p.BillingRatio
	if ratio <= 0 || math.IsNaN(ratio) || math.IsInf(ratio, 0) {
		return 0, fmt.Errorf("billing ratio must be finite and greater than zero")
	}
	return ratio, nil
}
