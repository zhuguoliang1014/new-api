package model

import (
	"encoding/json"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
)

// PopulateSubscriptionPurchaseRatios adds display-only purchase rates to a log
// page. It never changes quota or the recorded billing multiplier. Orders and
// subscription grants live in the main DB even when logs use a separate DB.
func PopulateSubscriptionPurchaseRatios(logs []*Log, rechargeUnitPrice float64) error {
	if !positiveFinite(rechargeUnitPrice) || !positiveFinite(common.QuotaPerUnit) {
		return nil
	}
	type candidate struct {
		log   *Log
		other map[string]json.RawMessage
		id    int
		total int64
	}
	var candidates []candidate
	ids := make([]int, 0)
	seen := make(map[int]bool)
	for _, log := range logs {
		if log == nil || (log.Type != LogTypeConsume && log.Type != LogTypeRefund) {
			continue
		}
		var metadata struct {
			Source string `json:"billing_source"`
			Basis  string `json:"billing_ratio_source"`
			ID     int    `json:"subscription_id"`
			Total  int64  `json:"subscription_total"`
		}
		if common.Unmarshal([]byte(log.Other), &metadata) != nil || metadata.Source != "subscription" || metadata.ID <= 0 ||
			(metadata.Basis != "subscription_unit" && metadata.Basis != "subscription_plan") {
			continue
		}
		var other map[string]json.RawMessage
		if common.Unmarshal([]byte(log.Other), &other) != nil {
			continue
		}
		candidates = append(candidates, candidate{log, other, metadata.ID, metadata.Total})
		if !seen[metadata.ID] {
			ids = append(ids, metadata.ID)
			seen[metadata.ID] = true
		}
	}
	if len(ids) == 0 {
		return nil
	}
	type purchase struct {
		ID, UserID      int
		AmountTotal     int64
		Money           float64
		PaymentProvider string
	}
	bases := make(map[int]purchase)
	counts := make(map[int]int)
	for start := 0; start < len(ids); start += 500 {
		var purchases []purchase
		// A timestamp match is usable only when both the grant and the paid
		// order are unambiguous. Do not substitute today's plan price or quota.
		err := DB.Table("user_subscriptions AS s").
			Select("s.id, s.user_id, s.amount_total, o.money, o.payment_provider").
			Joins("JOIN subscription_orders AS o ON o.user_id = s.user_id AND o.plan_id = s.plan_id AND o.complete_time = s.created_at").
			Where("s.id IN ? AND o.status = ?", ids[start:min(start+500, len(ids))], common.TopUpStatusSuccess).
			Where("(SELECT COUNT(*) FROM user_subscriptions AS siblings WHERE siblings.user_id = s.user_id AND siblings.plan_id = s.plan_id AND siblings.created_at = s.created_at) = 1").
			Scan(&purchases).Error
		if err != nil {
			return err
		}
		for _, basis := range purchases {
			bases[basis.ID] = basis
			counts[basis.ID]++
		}
	}
	for _, candidate := range candidates {
		basis, ok := bases[candidate.id]
		if !ok || counts[candidate.id] != 1 || basis.UserID != candidate.log.UserId || !positiveFinite(basis.Money) {
			continue
		}
		// These gateways store CNY paid amounts. Other providers have no
		// historical currency conversion, so leave their purchase rate unknown.
		if basis.PaymentProvider != PaymentProviderHupijiao && basis.PaymentProvider != PaymentProviderEpay {
			continue
		}
		total := candidate.total
		if total <= 0 {
			total = basis.AmountTotal
		}
		if total <= 0 {
			continue
		}
		ratio, _ := decimal.NewFromFloat(basis.Money).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).
			Div(decimal.NewFromInt(total)).Div(decimal.NewFromFloat(rechargeUnitPrice)).Float64()
		if !positiveFinite(ratio) {
			continue
		}
		candidate.other["subscription_purchase_ratio"], _ = common.Marshal(ratio)
		if value, err := common.Marshal(candidate.other); err == nil {
			candidate.log.Other = string(value)
		}
	}
	return nil
}

func positiveFinite(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}
