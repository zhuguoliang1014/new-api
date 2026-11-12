package model

import (
	"encoding/json"
	"errors"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// DiscountFactor is evaluated on every quote, including at order insertion.
// An exclusive end boundary restores the regular price without a scheduled job.
func (p *SubscriptionPlan) DiscountFactor(now int64) float64 {
	if p.DiscountRate == nil || *p.DiscountRate >= 1 || *p.DiscountRate <= 0 || math.IsNaN(*p.DiscountRate) || math.IsInf(*p.DiscountRate, 0) {
		return 1
	}
	if p.DiscountStartsAt > now || p.DiscountEndsAt <= now {
		return 1
	}
	return *p.DiscountRate
}

func (p *SubscriptionPlan) ValidatePromotion() error {
	if p.DiscountRate != nil && (math.IsNaN(*p.DiscountRate) || math.IsInf(*p.DiscountRate, 0) || *p.DiscountRate <= 0 || *p.DiscountRate > 1) {
		return common.NewMessage("Discount rate must be greater than 0 and at most 1")
	}
	if p.DiscountStartsAt < 0 || p.DiscountEndsAt < 0 || (p.DiscountRate != nil && *p.DiscountRate < 1 && (p.DiscountEndsAt <= 0 || p.DiscountEndsAt <= p.DiscountStartsAt)) {
		return common.NewMessage("Discount end time must be later than start time")
	}
	if p.DiscountRate != nil && *p.DiscountRate < 1 {
		if p.StripePriceId != "" || p.CreemProductId != "" {
			return common.NewMessage("Scheduled discounts require a payment method with dynamic pricing")
		}
		if discountedPrice(p.PriceCNY, *p.DiscountRate, 2) <= 0 || (p.PriceAmount > 0 && discountedPrice(p.PriceAmount, *p.DiscountRate, 6) <= 0) {
			return common.NewMessage("Discounted price must be greater than zero")
		}
	}
	if p.MinimumEffectiveRatio != nil {
		if *p.MinimumEffectiveRatio <= 0 || math.IsNaN(*p.MinimumEffectiveRatio) || math.IsInf(*p.MinimumEffectiveRatio, 0) || p.TotalAmount <= 0 || common.QuotaPerUnit <= 0 || p.QuotaResetPeriod != SubscriptionResetNever || p.DurationUnit != SubscriptionDurationMonth || p.DurationValue != 1 || p.AllowedChannelTypes != "1" {
			return common.NewMessage("Minimum effective multiplier requires a GPT plan with a fixed monthly quota")
		}
		ratio, err := p.EffectiveBillingRatio()
		if err != nil {
			return err
		}
		rate := 1.0
		if p.DiscountRate != nil {
			rate = *p.DiscountRate
		}
		price := decimal.NewFromFloat(discountedPrice(p.PriceCNY, rate, 2))
		effective := price.Mul(decimal.NewFromFloat(ratio)).Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Div(decimal.NewFromInt(p.TotalAmount))
		if effective.LessThan(decimal.NewFromFloat(*p.MinimumEffectiveRatio)) {
			return common.NewMessage("Discounted effective multiplier is below the configured minimum")
		}
	}
	return nil
}

func discountedPrice(amount, rate float64, places int32) float64 {
	value, _ := decimal.NewFromFloat(amount).Mul(decimal.NewFromFloat(rate)).Round(places).Float64()
	return value
}

func (p *SubscriptionPlan) PurchaseQuote(now int64) SubscriptionPlan {
	quote := *p
	rate := p.DiscountFactor(now)
	quote.PriceCNY = discountedPrice(p.PriceCNY, rate, 2)
	quote.PriceAmount = discountedPrice(p.PriceAmount, rate, 6)
	return quote
}

// Payment controllers fetch a fresh quote; cached catalog entries never fix a
// promotion boundary or administrator edit for a new checkout.
func GetSubscriptionPurchasePlanById(id int) (*SubscriptionPlan, error) {
	var plan SubscriptionPlan
	if err := DB.First(&plan, id).Error; err != nil {
		return nil, err
	}
	plan.NormalizeDefaults()
	if err := plan.ValidatePromotion(); err != nil {
		return nil, err
	}
	quote := plan.PurchaseQuote(common.GetTimestamp())
	return &quote, nil
}

func validateSubscriptionQuote(plan, quote *SubscriptionPlan, now int64) error {
	current := plan.PurchaseQuote(now)
	current.NormalizeDefaults()
	quoted := *quote
	quoted.NormalizeDefaults()
	currentJSON, err := encodeSubscriptionPlan(&current)
	if err != nil {
		return err
	}
	quotedJSON, err := encodeSubscriptionPlan(&quoted)
	if err != nil {
		return err
	}
	if currentJSON != quotedJSON {
		return common.NewMessage("Subscription plan changed. Please refresh and try again.")
	}
	return nil
}

func encodeSubscriptionPlan(plan *SubscriptionPlan) (string, error) {
	data, err := json.Marshal(plan)
	return string(data), err
}

func subscriptionPlanFromSnapshot(snapshot string, fallback *SubscriptionPlan) (*SubscriptionPlan, error) {
	if snapshot == "" {
		if fallback == nil {
			return nil, errors.New("subscription plan snapshot is missing")
		}
		return fallback, nil
	}
	var plan SubscriptionPlan
	if err := json.Unmarshal([]byte(snapshot), &plan); err != nil {
		return nil, err
	}
	if plan.Id <= 0 {
		return nil, errors.New("invalid subscription plan snapshot")
	}
	plan.NormalizeDefaults()
	return &plan, nil
}

func getUserSubscriptionPlanTx(tx *gorm.DB, sub *UserSubscription) (*SubscriptionPlan, error) {
	if sub.PlanSnapshot != "" {
		return subscriptionPlanFromSnapshot(sub.PlanSnapshot, nil)
	}
	return getSubscriptionPlanByIdTx(tx, sub.PlanId)
}

// Call under the product lock before any edit or removal. Legacy terms are
// captured once; later edits cannot overwrite a purchased snapshot.
func SnapshotLegacySubscriptionPlanTx(tx *gorm.DB, planID int) error {
	plan, err := lockSubscriptionSalePlanTx(tx, planID)
	if err != nil {
		return err
	}
	snapshot, err := encodeSubscriptionPlan(plan)
	if err != nil {
		return err
	}
	for _, table := range []any{&UserSubscription{}, &SubscriptionOrder{}} {
		if err := tx.Model(table).Where("plan_id = ? AND (plan_snapshot IS NULL OR plan_snapshot = '')", planID).UpdateColumn("plan_snapshot", snapshot).Error; err != nil {
			return err
		}
	}
	return nil
}

// An already issued checkout may outlive its catalog product. Its stored terms
// still deliver the purchased entitlement; a removed product accepts no new orders.
func lockSubscriptionOrderPlanTx(tx *gorm.DB, order *SubscriptionOrder) (*SubscriptionPlan, error) {
	plan, err := lockSubscriptionSalePlanTx(tx, order.PlanId)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// A catalog cleanup can fill the snapshot after the callback's first
		// read and then remove the product. Reload under this transaction.
		var persisted SubscriptionOrder
		if readErr := tx.Select("plan_snapshot").Where("trade_no = ?", order.TradeNo).First(&persisted).Error; readErr == nil && persisted.PlanSnapshot != "" {
			return subscriptionPlanFromSnapshot(persisted.PlanSnapshot, nil)
		}
		return subscriptionPlanFromSnapshot(order.PlanSnapshot, nil)
	}
	return plan, err
}

func (p *SubscriptionPlan) IsLimitedSale() bool { return p.LimitedSale || p.SalesLimit > 0 }

// A stale browser must never silently accept the higher regular price.
func (p *SubscriptionPlan) CheckExpectedPrice(expected *float64, cny bool) error {
	price := p.PriceAmount
	if cny {
		price = p.PriceCNY
	}
	if expected == nil {
		if p.DiscountRate != nil && *p.DiscountRate < 1 {
			return common.NewMessage("Subscription plan changed. Please refresh and try again.")
		}
		return nil
	}
	if math.IsNaN(*expected) || math.IsInf(*expected, 0) || *expected != price {
		return common.NewMessage("Subscription plan changed. Please refresh and try again.")
	}
	return nil
}

func getSubscriptionResetPlanTx(tx *gorm.DB, planID, userID int) (*SubscriptionPlan, error) {
	plan, err := getSubscriptionPlanByIdTx(tx, planID)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return plan, err
	}
	var sub UserSubscription
	query := tx.Where("plan_id = ? AND plan_snapshot IS NOT NULL AND plan_snapshot <> ''", planID)
	if userID > 0 {
		query = query.Where("user_id = ?", userID)
	}
	if err := query.Order("id asc").First(&sub).Error; err != nil {
		return nil, err
	}
	return getUserSubscriptionPlanTx(tx, &sub)
}

// Promotion prices are pre-rounded by the server so browser floating point
// arithmetic cannot disagree with a payment amount at a half-cent boundary.
func (p *SubscriptionPlan) PromotionPrices() (float64, float64) {
	rate := 1.0
	if p.DiscountRate != nil && *p.DiscountRate > 0 && *p.DiscountRate <= 1 {
		rate = *p.DiscountRate
	}
	return discountedPrice(p.PriceCNY, rate, 2), discountedPrice(p.PriceAmount, rate, 6)
}
