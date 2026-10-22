package model

import (
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// populateActualCost converts settled quota to CNY without changing billing.
// Logs and purchase records may live in separate databases, so only purchase
// records are joined; filtered log metadata is streamed from the log database.
func populateActualCost(query *gorm.DB, stat *Stat) error {
	if common.QuotaPerUnit <= 0 || math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) {
		return nil
	}
	unit := decimal.NewFromFloat(common.QuotaPerUnit)
	cost := decimal.NewFromInt(int64(stat.Quota)).Div(unit)
	type subscriptionUsage struct {
		ID    int
		Total int64
	}
	usage := make(map[subscriptionUsage]decimal.Decimal)
	// LIKE is only a coarse prefilter. Decode the source before classifying it.
	rows, err := query.Session(&gorm.Session{}).Select("quota", "other").Where("other LIKE ?", "%subscription%").Rows()
	if err != nil {
		return err
	}
	unknown := false
	for rows.Next() {
		var quota int64
		var other string
		if err := rows.Scan(&quota, &other); err != nil {
			_ = rows.Close()
			return err
		}
		if quota == 0 {
			continue
		}
		var metadata struct {
			Source string `json:"billing_source"`
			ID     int    `json:"subscription_id"`
			Total  int64  `json:"subscription_total"`
		}
		if err := common.UnmarshalJsonStr(other, &metadata); err != nil {
			unknown = true
			continue
		}
		if metadata.Source != "subscription" {
			continue
		}
		key := subscriptionUsage{metadata.ID, metadata.Total}
		usage[key] = usage[key].Add(decimal.NewFromInt(quota))
	}
	err = rows.Err()
	_ = rows.Close() // Release SQLite's connection before querying the main DB.
	if err != nil {
		return err
	}
	if unknown {
		return nil
	}
	ids := make([]int, 0, len(usage))
	seen := make(map[int]bool)
	for key := range usage {
		if key.ID <= 0 {
			return nil
		}
		if !seen[key.ID] {
			ids = append(ids, key.ID)
			seen[key.ID] = true
		}
	}
	type purchaseBasis struct {
		ID               int
		AmountTotal      int64
		PriceCNY         float64
		QuotaResetPeriod string
		Money            float64
		PaymentProvider  string
	}
	bases := make(map[int]purchaseBasis)
	matches := make(map[int]int)
	for start := 0; start < len(ids); start += 500 {
		batch := ids[start:min(start+500, len(ids))]
		var plans []purchaseBasis
		if err := DB.Table("user_subscriptions AS s").
			Select("s.id, s.amount_total, p.price_cny, p.quota_reset_period").
			Joins("JOIN subscription_plans AS p ON p.id = s.plan_id").
			Where("s.id IN ?", batch).Scan(&plans).Error; err != nil {
			return err
		}
		for _, basis := range plans {
			bases[basis.ID] = basis
		}
		var orders []purchaseBasis
		if err := DB.Table("user_subscriptions AS s").
			Select("s.id, o.money, o.payment_provider").
			Joins("JOIN subscription_orders AS o ON o.user_id = s.user_id AND o.plan_id = s.plan_id AND o.complete_time = s.created_at").
			Where("s.id IN ? AND o.status = ?", batch, common.TopUpStatusSuccess).
			// If several grants share this timestamp, no order can be assigned reliably.
			Where("(SELECT COUNT(*) FROM user_subscriptions AS siblings WHERE siblings.user_id = s.user_id AND siblings.plan_id = s.plan_id AND siblings.created_at = s.created_at) = 1").
			Scan(&orders).Error; err != nil {
			return err
		}
		for _, order := range orders {
			basis, exists := bases[order.ID]
			if !exists {
				continue
			}
			basis.Money, basis.PaymentProvider = order.Money, order.PaymentProvider
			bases[order.ID] = basis
			matches[order.ID]++
		}
	}
	for key, quota := range usage {
		basis, exists := bases[key.ID]
		// A renewing allowance is not the entire purchased grant. Without a
		// historical cycle count, treating one cycle as the purchase is misleading.
		if !exists || (basis.QuotaResetPeriod != "" && basis.QuotaResetPeriod != SubscriptionResetNever) {
			return nil
		}
		total := key.Total
		if total <= 0 {
			total = basis.AmountTotal
			stat.ActualCostEstimated = true
		}
		if total <= 0 {
			return nil
		}
		price := basis.PriceCNY
		paidCNY := basis.PaymentProvider == PaymentProviderHupijiao || basis.PaymentProvider == PaymentProviderEpay || basis.PaymentProvider == PaymentProviderBalance
		if matches[key.ID] == 1 && paidCNY {
			price = basis.Money
		} else {
			stat.ActualCostEstimated = true
		}
		if price <= 0 || math.IsNaN(price) || math.IsInf(price, 0) {
			return nil
		}
		cost = cost.Sub(quota.Div(unit)).Add(quota.Mul(decimal.NewFromFloat(price)).Div(decimal.NewFromInt(total)))
	}
	amount, _ := cost.Float64()
	if math.IsNaN(amount) || math.IsInf(amount, 0) {
		return nil
	}
	stat.ActualCostCNY = &amount
	return nil
}
