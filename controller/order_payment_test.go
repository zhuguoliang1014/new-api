package controller

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOrderActionsAdminRequiresProviderProof(t *testing.T) {
	for _, tc := range []struct {
		name, state, remote, amount          string
		paid, mismatch, failed, subscription bool
	}{
		{name: "paid wallet", state: "pending", remote: "OD", amount: "20", paid: true},
		{name: "late canceled wallet", state: "canceled", remote: "OD", amount: "20", paid: true},
		{name: "paid subscription", state: "expired", remote: "OD", amount: "20", paid: true, subscription: true},
		{name: "unpaid wallet", state: "pending", remote: "WP", amount: "20"},
		{name: "wrong amount", state: "pending", remote: "OD", amount: "21"},
		{name: "wrong identity", state: "pending", remote: "OD", amount: "20", mismatch: true},
		{name: "query unavailable", state: "pending", failed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, user := hupijiaoRecoveryDB(t)
			order := hupijiaoTestOrder(t, db, user, "admin-proof", tc.state, common.GetTimestamp()-3600)
			if tc.subscription {
				plan := model.SubscriptionPlan{Title: "order action", PriceAmount: 40, PriceCNY: 20, TotalAmount: 1000, DurationUnit: model.SubscriptionDurationMonth, DurationValue: 1, Enabled: true}
				require.NoError(t, db.Create(&plan).Error)
				t.Cleanup(func() { require.NoError(t, db.Delete(&plan).Error); model.InvalidateSubscriptionPlanCache(plan.Id) })
				require.NoError(t, db.Model(order).Update("amount", 0).Error)
				require.NoError(t, db.Create(&model.SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, TradeNo: order.TradeNo, Money: 20, PaymentMethod: order.PaymentMethod, PaymentProvider: order.PaymentProvider, Status: tc.state}).Error)
			}
			hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) {
				if tc.failed {
					return nil, fmt.Errorf("unavailable")
				}
				trade := order.TradeNo
				if tc.mismatch {
					trade = "foreign-order"
				}
				return hupijiaoTestResponse(t, r, trade, order.OpenOrderId, tc.remote, tc.amount)
			})
			for range 2 {
				r := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(r)
				c.Request = httptest.NewRequest(http.MethodPost, "/api/user/topup/complete", strings.NewReader(fmt.Sprintf(`{"trade_no":%q}`, order.TradeNo)))
				c.Request.Header.Set("Content-Type", "application/json")
				AdminCompleteTopUp(c)
				var response struct {
					Success bool `json:"success"`
				}
				require.NoError(t, common.Unmarshal(r.Body.Bytes(), &response))
				assert.Equal(t, tc.paid, response.Success, r.Body.String())
			}
			saved := model.GetTopUpByTradeNo(order.TradeNo)
			var quota int
			require.NoError(t, db.Model(&model.User{}).Where("id = ?", user.Id).Select("quota").Scan(&quota).Error)
			if !tc.paid {
				assert.Equal(t, tc.state, saved.Status)
				assert.Equal(t, 7, quota)
			} else {
				assert.Equal(t, common.TopUpStatusSuccess, saved.Status)
				if tc.subscription {
					var count int64
					require.NoError(t, db.Model(&model.UserSubscription{}).Where("user_id = ?", user.Id).Count(&count).Error)
					assert.EqualValues(t, 1, count)
					assert.Equal(t, 7, quota)
				} else {
					assert.Equal(t, 10000007, quota)
				}
			}
		})
	}
}

func TestOrderActionsCloseSynchronizesSubscriptionAndHonorsLatePayment(t *testing.T) {
	db, user := hupijiaoRecoveryDB(t)
	order := hupijiaoTestOrder(t, db, user, "close", "pending", common.GetTimestamp())
	plan := model.SubscriptionPlan{Title: "close then paid", PriceAmount: 20, PriceCNY: 20, TotalAmount: 1000, DurationUnit: model.SubscriptionDurationMonth, DurationValue: 1, Enabled: true}
	require.NoError(t, db.Create(&plan).Error)
	t.Cleanup(func() { require.NoError(t, db.Delete(&plan).Error); model.InvalidateSubscriptionPlanCache(plan.Id) })
	require.NoError(t, db.Model(order).Update("amount", 0).Error)
	sub := model.SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, TradeNo: order.TradeNo, Money: 20, PaymentProvider: order.PaymentProvider, PaymentMethod: order.PaymentMethod, Status: "pending"}
	require.NoError(t, db.Create(&sub).Error)
	require.NoError(t, model.ExpireUnpaidOrder(order.TradeNo, order.PaymentProvider))
	require.NoError(t, db.First(&sub, sub.Id).Error)
	assert.Equal(t, "expired", sub.Status)
	assert.Equal(t, "expired", model.GetTopUpByTradeNo(order.TradeNo).Status)
	remote := "WP"
	hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) {
		return hupijiaoTestResponse(t, r, order.TradeNo, order.OpenOrderId, remote, "20")
	})
	for _, owner := range []int{user.Id + 1, user.Id} {
		r := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(r)
		c.Request = httptest.NewRequest(http.MethodDelete, "/", nil)
		c.Set("id", owner)
		c.Params = gin.Params{{Key: "trade_no", Value: order.TradeNo}}
		CancelTopUpOrder(c)
		if owner != user.Id {
			require.Equal(t, http.StatusForbidden, r.Code)
			continue
		}
		require.Contains(t, r.Body.String(), `"success":true`)
	}
	require.NoError(t, db.First(&sub, sub.Id).Error)
	assert.Equal(t, "canceled", sub.Status)
	assert.Equal(t, "canceled", model.GetTopUpByTradeNo(order.TradeNo).Status)
	remote = "OD"
	paid, err := verifyOrderPayment(t.Context(), model.GetTopUpByTradeNo(order.TradeNo), "test_late")
	require.NoError(t, err)
	assert.True(t, paid)
	require.NoError(t, db.First(&sub, sub.Id).Error)
	assert.Equal(t, "success", sub.Status)
	assert.Equal(t, "success", model.GetTopUpByTradeNo(order.TradeNo).Status)
	require.Error(t, model.CloseUnpaidOrder(order.TradeNo, order.PaymentProvider, nil))
}

func TestOrderActionsResumeReusesLiveLinkAndReplacesLegacyCheckout(t *testing.T) {
	db, user := hupijiaoRecoveryDB(t)
	confirmPaymentComplianceForTest(t)
	oldEnabled, oldID, oldSecret := setting.HupijiaoEnabled, setting.HupijiaoAppId, setting.HupijiaoAppSecret
	setting.HupijiaoEnabled, setting.HupijiaoAppId, setting.HupijiaoAppSecret = true, "test-id", "test-secret"
	t.Cleanup(func() {
		setting.HupijiaoEnabled, setting.HupijiaoAppId, setting.HupijiaoAppSecret = oldEnabled, oldID, oldSecret
	})
	order := hupijiaoTestOrder(t, db, user, "resume", "pending", common.GetTimestamp())
	order.PayUrl = "https://pay.example/original"
	require.NoError(t, order.UpdateOpenOrderID())
	created := 0
	hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) {
		if strings.HasSuffix(r.URL.Path, "query.html") {
			return hupijiaoTestResponse(t, r, order.TradeNo, order.OpenOrderId, "WP", "20")
		}
		created++
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"errcode":0,"url":"https://pay.example/replacement","openid":"new-provider-id"}`))}, nil
	})
	for _, legacy := range []bool{false, true} {
		if legacy {
			require.NoError(t, db.Model(order).Updates(map[string]any{"pay_url": "", "create_time": time.Now().Add(-time.Hour).Unix()}).Error)
		}
		r := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(r)
		c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
		c.Set("id", user.Id)
		c.Set("username", user.Username)
		c.Params = gin.Params{{Key: "trade_no", Value: order.TradeNo}}
		RepayTopUpOrder(c)
		var response struct {
			Success bool `json:"success"`
			Data    struct {
				TradeNo string `json:"trade_no"`
				PayURL  string `json:"pay_url"`
			} `json:"data"`
		}
		require.NoError(t, common.Unmarshal(r.Body.Bytes(), &response))
		require.True(t, response.Success, r.Body.String())
		if !legacy {
			assert.Equal(t, order.TradeNo, response.Data.TradeNo)
			assert.Zero(t, created)
		} else {
			assert.NotEqual(t, order.TradeNo, response.Data.TradeNo)
			assert.Equal(t, 1, created)
			assert.Equal(t, "canceled", model.GetTopUpByTradeNo(order.TradeNo).Status)
			assert.Equal(t, order.OpenOrderId, model.GetTopUpByTradeNo(order.TradeNo).OpenOrderId)
			next := model.GetTopUpByTradeNo(response.Data.TradeNo)
			require.NotNil(t, next)
			assert.Equal(t, int64(2000), next.Amount)
			assert.Equal(t, 20.0, next.Money)
			assert.Equal(t, "https://pay.example/replacement", next.PayUrl)
		}
	}
}

func TestOrderActionsCheckoutLinkMigrationPreservesExistingOrders(t *testing.T) {
	db := subscriptionBillingDB(t, true)
	// Matches the pre-change production table, without the new private links.
	type legacyTopUp struct {
		Id              int `gorm:"primaryKey"`
		UserId          int `gorm:"index"`
		Amount          int64
		Money           float64
		TradeNo         string `gorm:"unique;type:varchar(255);index"`
		OpenOrderId     string `gorm:"type:varchar(100);default:''"`
		PaymentMethod   string `gorm:"type:varchar(50)"`
		PaymentProvider string `gorm:"type:varchar(50);default:''"`
		CreateTime      int64
		CompleteTime    int64
		Status          string
	}
	for _, upgrade := range []bool{false, true} {
		table := fmt.Sprintf("order_link_migration_%v", upgrade)
		require.NoError(t, db.Migrator().DropTable(table))
		t.Cleanup(func() { require.NoError(t, db.Migrator().DropTable(table)) })
		if upgrade {
			require.NoError(t, db.Table(table).AutoMigrate(&legacyTopUp{}))
			require.NoError(t, db.Table(table).Create(&legacyTopUp{Id: 1, UserId: 1, Amount: 2000, Money: 20, TradeNo: "preserved-order", Status: "pending"}).Error)
		}
		for range 2 {
			require.NoError(t, db.Table(table).AutoMigrate(&model.TopUp{}))
		}
		if upgrade {
			var saved model.TopUp
			require.NoError(t, db.Table(table).First(&saved, 1).Error)
			assert.Equal(t, "preserved-order", saved.TradeNo)
			assert.Equal(t, int64(2000), saved.Amount)
			assert.Empty(t, saved.PayUrl)
			saved.Id = 0
			assert.Error(t, db.Table(table).Create(&saved).Error, "trade number must remain unique")
		}
	}
}

func TestOrderActionsEpayClosedOrdersRequireProofAndSettleOnce(t *testing.T) {
	db, user := nativeEpayFixture(t)
	for _, state := range []string{"pending", "expired", "canceled"} {
		order := model.TopUp{UserId: user.Id, Amount: 10, Money: 10, TradeNo: "native-closed-" + state, PaymentProvider: model.PaymentProviderEpay, PaymentMethod: "alipay", Status: state, CreateTime: common.GetTimestamp()}
		require.NoError(t, db.Create(&order).Error)
		hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) {
			body, err := common.Marshal(map[string]any{"code": 1, "status": "1", "pid": "2043", "out_trade_no": order.TradeNo, "trade_no": "provider-" + order.TradeNo, "type": "alipay", "money": "10.00"})
			require.NoError(t, err)
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(body)))}, nil
		})
		for range 2 {
			paid, err := verifyOrderPayment(t.Context(), &order, "test_admin")
			require.NoError(t, err)
			assert.True(t, paid)
		}
		assert.Equal(t, "success", model.GetTopUpByTradeNo(order.TradeNo).Status)
	}
	var saved model.User
	require.NoError(t, db.First(&saved, user.Id).Error)
	assert.Equal(t, 15000007, saved.Quota)
}
