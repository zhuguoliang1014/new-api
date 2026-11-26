package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionFreezeCardsPlanAndSelfAPI(t *testing.T) {
	db := subscriptionBillingDB(t)
	confirmPaymentComplianceForTest(t)
	plan := model.SubscriptionPlan{Title: "Card API", PriceAmount: 100, PriceCNY: 99, DurationUnit: "month", DurationValue: 1, FreezeCards: 3}
	call := func(handler gin.HandlerFunc, body []byte, id int, userId int) []byte {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", userId)
		c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(id)}}
		c.Request = httptest.NewRequest(http.MethodPost, "/subscription", bytes.NewReader(body))
		c.Request.Header.Set("Content-Type", "application/json")
		handler(c)
		return recorder.Body.Bytes()
	}
	body, err := common.Marshal(AdminUpsertSubscriptionPlanRequest{Plan: plan})
	require.NoError(t, err)
	require.Contains(t, string(call(AdminCreateSubscriptionPlan, body, 0, 0)), `"success":true`)
	require.NoError(t, db.Where("title = ?", plan.Title).First(&plan).Error)
	require.Equal(t, 3, plan.FreezeCards)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	for _, n := range []int{5, 0, -1, 1000001} {
		plan.FreezeCards = n
		body, err = common.Marshal(AdminUpsertSubscriptionPlanRequest{Plan: plan})
		require.NoError(t, err)
		valid := n >= 0 && n <= 1000000
		require.Contains(t, string(call(AdminUpdateSubscriptionPlan, body, plan.Id, 0)), fmt.Sprintf(`"success":%t`, valid))
		var saved model.SubscriptionPlan
		require.NoError(t, db.First(&saved, plan.Id).Error)
		if valid {
			require.Equal(t, n, saved.FreezeCards)
		} else {
			require.Zero(t, saved.FreezeCards)
		}
	}
	user := model.User{Username: "cards-api", AffCode: "cards-api", FreezeCards: 7}
	require.NoError(t, db.Create(&user).Error)
	var response struct {
		Success bool
		Data    struct {
			FreezeCards int `json:"freeze_cards"`
		}
	}
	require.NoError(t, common.Unmarshal(call(GetSubscriptionSelf, nil, 0, user.Id), &response))
	require.True(t, response.Success)
	require.Equal(t, 7, response.Data.FreezeCards)
	// Consent must be a boolean; malformed consent must never spend a card.
	require.Contains(t, string(call(SetSubscriptionFrozen, []byte(`{"frozen":true,"use_freeze_card":"true"}`), 1, user.Id)), `"success":false`)
	require.NoError(t, db.First(&user, user.Id).Error)
	require.Equal(t, 7, user.FreezeCards)
}
