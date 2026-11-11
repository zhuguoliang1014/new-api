package model

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestPurchasedSubscriptionKeepsOriginalPlanAfterEdit(t *testing.T) {
	truncateTables(t)
	plan := &SubscriptionPlan{Title: "Original GPT month", Enabled: true, PriceAmount: 100, PriceCNY: 100, TotalAmount: 50000000, DurationUnit: "month", DurationValue: 1, AllowedChannelTypes: "1", BillingRatio: common.GetPointer(0.3)}
	require.NoError(t, DB.Create(plan).Error)
	sub, err := CreateUserSubscriptionFromPlanTx(DB, 123, plan, "admin")
	require.NoError(t, err)
	require.NoError(t, DB.Model(plan).Updates(map[string]any{"title": "Changed", "billing_ratio": 0.9, "allowed_channel_types": "14", "quota_reset_period": "daily"}).Error)
	InvalidateSubscriptionPlanCache(plan.Id)
	summaries := buildSubscriptionSummaries([]UserSubscription{*sub})
	require.Equal(t, "Original GPT month", summaries[0].PlanTitle)
	require.Equal(t, "1", summaries[0].Plan.AllowedChannelTypes)
	require.InDelta(t, 0.3, *summaries[0].Plan.BillingRatio, 0.000001)
}

func TestSubscriptionPromotionBoundariesPreserveQuota(t *testing.T) {
	plan := &SubscriptionPlan{Id: 1, PriceAmount: 100, PriceCNY: 100, TotalAmount: 50000000, BillingRatio: common.GetPointer(0.3), DiscountRate: common.GetPointer(0.8), DiscountStartsAt: 100, DiscountEndsAt: 200}
	require.NoError(t, plan.ValidatePromotion())
	for _, test := range []struct {
		now   int64
		price float64
	}{{99, 100}, {100, 80}, {199, 80}, {200, 100}, {201, 100}} {
		quote := plan.PurchaseQuote(test.now)
		require.Equal(t, test.price, quote.PriceCNY)
		require.Equal(t, test.price, quote.PriceAmount)
		require.Equal(t, plan.TotalAmount, quote.TotalAmount)
		require.InDelta(t, 0.3, *quote.BillingRatio, 0.000001)
	}
	require.Equal(t, 100.0, plan.PriceCNY)
	require.Error(t, plan.CheckExpectedPrice(common.GetPointer(80.0), true))
	require.Error(t, plan.CheckExpectedPrice(nil, true))
	require.NoError(t, plan.CheckExpectedPrice(common.GetPointer(100.0), true))
	plan.DiscountEndsAt = 0
	require.Error(t, plan.ValidatePromotion())
	plan.DiscountRate = common.GetPointer(0.0)
	require.Error(t, plan.ValidatePromotion())
}

func TestOrderDeliversPurchasedSnapshotAfterPlanEditAndDeletion(t *testing.T) {
	truncateTables(t)
	plan := &SubscriptionPlan{Title: "Purchased GPT", Enabled: true, PriceAmount: 100, PriceCNY: 100, TotalAmount: 50000000, DurationUnit: "month", DurationValue: 1, AllowedChannelTypes: "1", BillingRatio: common.GetPointer(0.3), SalesLimit: 1}
	require.NoError(t, DB.Create(plan).Error)
	order := &SubscriptionOrder{UserId: 345, PlanId: plan.Id, TradeNo: "snapshot-paid", Money: 100, PaymentProvider: SubscriptionPaymentProviderHupijiao, Status: common.TopUpStatusPending}
	require.NoError(t, order.Insert())
	require.NoError(t, DB.Model(plan).Updates(map[string]any{"title": "New product", "billing_ratio": 0.9, "total_amount": 1, "allowed_channel_types": "14"}).Error)
	require.NoError(t, DB.Delete(plan).Error)
	InvalidateSubscriptionPlanCache(plan.Id)
	require.NoError(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 100, "verified"))
	require.NoError(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 100, "verified"))
	var subs []UserSubscription
	require.NoError(t, DB.Where("plan_id = ?", plan.Id).Find(&subs).Error)
	require.Len(t, subs, 1)
	require.EqualValues(t, 50000000, subs[0].AmountTotal)
	summaries := buildSubscriptionSummaries(subs)
	require.Equal(t, "Purchased GPT", summaries[0].PlanTitle)
	require.Equal(t, "1", summaries[0].Plan.AllowedChannelTypes)
	require.InDelta(t, 0.3, *summaries[0].Plan.BillingRatio, 0.000001)
}

func TestLimitedEditionWithZeroStockCannotBePurchased(t *testing.T) {
	truncateTables(t)
	plan := &SubscriptionPlan{Title: "Limited", Enabled: true, LimitedSale: true, SalesLimit: 0, PriceAmount: 1, PriceCNY: 1, TotalAmount: 10, DurationUnit: "month", DurationValue: 1}
	require.NoError(t, DB.Create(plan).Error)
	order := &SubscriptionOrder{UserId: 123, PlanId: plan.Id, TradeNo: "limited-zero", Status: common.TopUpStatusPending}
	require.ErrorIs(t, order.Insert(), ErrSubscriptionSoldOut)
	require.NoError(t, DB.Model(plan).Update("sales_limit", 1).Error)
	require.NoError(t, order.Insert())
	require.ErrorIs(t, (&SubscriptionOrder{UserId: 123, PlanId: plan.Id, TradeNo: "limited-zero-two", Status: common.TopUpStatusPending}).Insert(), ErrSubscriptionSalesReserved)
}

func TestLegacySnapshotAndBillingAreUnaffectedByCatalogEdits(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&SubscriptionPreConsumeRecord{}))
	plan := &SubscriptionPlan{Title: "Legacy GPT", Enabled: true, PriceAmount: 50, PriceCNY: 49, TotalAmount: 1000000, DurationUnit: "month", DurationValue: 1, AllowedChannelTypes: "1", BillingRatio: common.GetPointer(0.3)}
	require.NoError(t, DB.Create(plan).Error)
	sub := &UserSubscription{UserId: 234, PlanId: plan.Id, AmountTotal: 1000000, StartTime: common.GetTimestamp(), EndTime: common.GetTimestamp() + 86400, Status: "active"}
	require.NoError(t, DB.Create(sub).Error)
	require.NoError(t, SnapshotLegacySubscriptionPlanTx(DB, plan.Id))
	var first UserSubscription
	require.NoError(t, DB.First(&first, sub.Id).Error)
	require.NotEmpty(t, first.PlanSnapshot)
	require.NoError(t, DB.Model(plan).Updates(map[string]any{"title": "Claude", "billing_ratio": 0.9, "allowed_channel_types": "14"}).Error)
	require.NoError(t, SnapshotLegacySubscriptionPlanTx(DB, plan.Id))
	var second UserSubscription
	require.NoError(t, DB.First(&second, sub.Id).Error)
	require.Equal(t, first.PlanSnapshot, second.PlanSnapshot)
	require.Equal(t, first.StartTime, second.StartTime)
	require.Equal(t, first.EndTime, second.EndTime)
	InvalidateSubscriptionPlanCache(plan.Id)
	result, err := PreConsumeUserSubscriptionWithPricing("snapshot-billing-test", 234, "gpt-6.1-sol", 360, 1000, false)
	require.NoError(t, err)
	require.InDelta(t, 0.3, result.BillingRatio, 0.000001)
	require.EqualValues(t, 300, result.PreConsumed)
	require.NoError(t, DB.Where("request_id = ?", "snapshot-billing-test").Delete(&SubscriptionPreConsumeRecord{}).Error)
}

func TestSubscriptionPromotionPriceFloor(t *testing.T) {
	plan := &SubscriptionPlan{Id: 1, DurationUnit: "month", DurationValue: 1, PriceCNY: 999, PriceAmount: 4343.47826, TotalAmount: 2171739130, AllowedChannelTypes: "1", QuotaResetPeriod: "never", BillingRatio: common.GetPointer(1.0), MinimumEffectiveRatio: common.GetPointer(0.18), DiscountRate: common.GetPointer(0.8), DiscountEndsAt: common.GetTimestamp() + 3600}
	require.NoError(t, plan.ValidatePromotion(), "0.23 × 0.8 = 0.184 remains above 0.18")
	plan.DiscountRate = common.GetPointer(0.78)
	require.Error(t, plan.ValidatePromotion(), "0.23 × 0.78 = 0.1794 falls below the floor")
	plan.DiscountRate = common.GetPointer(0.8)
	plan.QuotaResetPeriod = "daily"
	require.Error(t, plan.ValidatePromotion(), "a repeating allowance cannot use a single-month price floor")
}

func TestRemovedCatalogPlanPreservesAdministrativeResetAndBilling(t *testing.T) {
	truncateTables(t)
	require.NoError(t, DB.AutoMigrate(&SubscriptionPreConsumeRecord{}))
	plan := &SubscriptionPlan{Title: "Archived monthly", Enabled: true, PriceAmount: 1, PriceCNY: 1, TotalAmount: 10000, DurationUnit: "month", DurationValue: 1, QuotaResetPeriod: "never", AllowedChannelTypes: "1", BillingRatio: common.GetPointer(1.0)}
	require.NoError(t, DB.Create(plan).Error)
	sub, err := CreateUserSubscriptionFromPlanTx(DB, 456, plan, "test")
	require.NoError(t, err)
	require.NoError(t, DB.Model(sub).Update("amount_used", 200).Error)
	require.NoError(t, DB.Delete(plan).Error)
	InvalidateSubscriptionPlanCache(plan.Id)
	reset, err := AdminResetUserSubscriptionsByPlan(456, plan.Id, true)
	require.NoError(t, err)
	require.Equal(t, 1, reset.ResetCount)
	got, err := PreConsumeUserSubscriptionWithPricing("archived-snapshot", 456, "gpt-6.1-sol", 10, 100, false)
	require.NoError(t, err)
	require.EqualValues(t, 100, got.PreConsumed)
	require.NoError(t, DB.Where("request_id = ?", "archived-snapshot").Delete(&SubscriptionPreConsumeRecord{}).Error)
}
