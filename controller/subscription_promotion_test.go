package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionPromotionAPISeparatesRegularAndPurchasePrices(t *testing.T) {
	db := subscriptionBillingDB(t)
	confirmPaymentComplianceForTest(t)
	now := time.Now().Unix()
	plan := model.SubscriptionPlan{Title: "GPT month", Enabled: true, PriceAmount: 100, PriceCNY: 99, DurationUnit: "month", DurationValue: 1, TotalAmount: 50000000, DiscountRate: common.GetPointer(0.8), DiscountStartsAt: now - 60, DiscountEndsAt: now + 60}
	require.NoError(t, db.Create(&plan).Error)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	GetSubscriptionPlans(c)
	var response struct {
		Success bool
		Data    []SubscriptionPlanDTO
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.True(t, response.Success)
	require.Len(t, response.Data, 1)
	require.Equal(t, 99.0, response.Data[0].RegularPriceCNY)
	require.Equal(t, 79.2, response.Data[0].Plan.PriceCNY)
	require.EqualValues(t, 50000000, response.Data[0].Plan.TotalAmount)
	var original model.SubscriptionPlan
	require.NoError(t, db.First(&original, plan.Id).Error)
	require.Equal(t, 99.0, original.PriceCNY)
	require.NoError(t, db.Model(&plan).Update("discount_ends_at", now).Error)
	recorder = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(recorder)
	GetSubscriptionPlans(c)
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	require.Equal(t, 99.0, response.Data[0].Plan.PriceCNY)
}

func TestSubscriptionPromotionEditSnapshotsLegacyAndRejectsInvalidSchedules(t *testing.T) {
	db := subscriptionBillingDB(t)
	confirmPaymentComplianceForTest(t)
	plan := model.SubscriptionPlan{Title: "Original GPT", Enabled: true, PriceAmount: 100, PriceCNY: 99, DurationUnit: "month", DurationValue: 1, TotalAmount: 50000000, AllowedChannelTypes: "1", BillingRatio: common.GetPointer(1.0)}
	require.NoError(t, db.Create(&plan).Error)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	sub := model.UserSubscription{UserId: 123, PlanId: plan.Id, AmountTotal: 50000000, Status: "active", EndTime: time.Now().Unix() + 86400}
	require.NoError(t, db.Create(&sub).Error)
	save := func() *httptest.ResponseRecorder {
		body, err := common.Marshal(AdminUpsertSubscriptionPlanRequest{Plan: plan})
		require.NoError(t, err)
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(plan.Id)}}
		c.Request = httptest.NewRequest(http.MethodPut, "/api/subscription/admin/plans/1", bytes.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		AdminUpdateSubscriptionPlan(c)
		return recorder
	}
	plan.DiscountRate = common.GetPointer(0.8)
	require.Contains(t, save().Body.String(), `"success":false`)
	plan.DiscountEndsAt = time.Now().Unix() + 3600
	plan.Title = "New GPT"
	plan.BillingRatio = common.GetPointer(0.3)
	require.Contains(t, save().Body.String(), `"success":true`)
	var purchased model.UserSubscription
	require.NoError(t, db.First(&purchased, sub.Id).Error)
	require.NotEmpty(t, purchased.PlanSnapshot)
	summaries, err := model.GetAllUserSubscriptions(sub.UserId)
	require.NoError(t, err)
	require.Len(t, summaries, 1)
	require.Equal(t, "Original GPT", summaries[0].PlanTitle)
	require.Equal(t, sub.AmountTotal, summaries[0].Subscription.AmountTotal)
	require.Equal(t, sub.EndTime, summaries[0].Subscription.EndTime)
}

func TestDisabledSubscriptionDraftNeverAppearsInPublicCatalog(t *testing.T) {
	db := subscriptionBillingDB(t)
	confirmPaymentComplianceForTest(t)
	plan := model.SubscriptionPlan{Title: "Unpublished GPT", Enabled: false, PriceAmount: 353.571428, PriceCNY: 99, DurationUnit: "month", DurationValue: 1, TotalAmount: 176785714, AllowedChannelTypes: "1", QuotaResetPeriod: "never", MinimumEffectiveRatio: common.GetPointer(0.18)}
	body, err := common.Marshal(AdminUpsertSubscriptionPlanRequest{Plan: plan})
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/subscription/admin/plans", bytes.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	AdminCreateSubscriptionPlan(c)
	require.Contains(t, recorder.Body.String(), `"success":true`)
	var persisted model.SubscriptionPlan
	require.NoError(t, db.Where("title = ?", plan.Title).First(&persisted).Error)
	require.False(t, persisted.Enabled)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(persisted.Id) })
	recorder = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(recorder)
	GetSubscriptionPlans(c)
	require.NotContains(t, recorder.Body.String(), plan.Title)
}

func TestSubscriptionPromotionPriceFloorRejectsDeeperDiscountAndPreservesPlan(t *testing.T) {
	db := subscriptionBillingDB(t)
	confirmPaymentComplianceForTest(t)
	plan := model.SubscriptionPlan{Title: "Star", Enabled: true, PriceAmount: 4343.47826, PriceCNY: 999, TotalAmount: 2171739130, DurationUnit: "month", DurationValue: 1, QuotaResetPeriod: "never", AllowedChannelTypes: "1", BillingRatio: common.GetPointer(1.0), MinimumEffectiveRatio: common.GetPointer(0.18), DiscountRate: common.GetPointer(1.0)}
	require.NoError(t, db.Create(&plan).Error)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	for _, rate := range []float64{0.8, 0.78} {
		plan.DiscountRate = common.GetPointer(rate)
		plan.DiscountEndsAt = time.Now().Unix() + 3600
		body, err := common.Marshal(AdminUpsertSubscriptionPlanRequest{Plan: plan})
		require.NoError(t, err)
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(plan.Id)}}
		c.Request = httptest.NewRequest(http.MethodPut, "/plans/1", bytes.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		AdminUpdateSubscriptionPlan(c)
		if rate == 0.8 {
			require.Contains(t, recorder.Body.String(), `"success":true`)
		} else {
			require.Contains(t, recorder.Body.String(), `"success":false`)
		}
	}
	var saved model.SubscriptionPlan
	require.NoError(t, db.First(&saved, plan.Id).Error)
	require.InDelta(t, 0.8, *saved.DiscountRate, 0.000001)
}
