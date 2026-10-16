package controller

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type hupijiaoTestTransport func(*http.Request) (*http.Response, error)

func (f hupijiaoTestTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func hupijiaoRecoveryDB(t *testing.T) (*gorm.DB, *model.User) {
	t.Helper()
	db := subscriptionBillingDB(t, true)
	require.NoError(t, db.AutoMigrate(&model.TopUp{}, &model.SubscriptionOrder{}))
	if common.MainDatabaseType() != common.DatabaseTypeSQLite {
		sqlDB, err := db.DB()
		require.NoError(t, err)
		sqlDB.SetMaxOpenConns(4)
	}
	require.NoError(t, db.Unscoped().Where("username = ?", "hupi-recovery-user").Delete(&model.User{}).Error)
	user := &model.User{Username: "hupi-recovery-user", AffCode: "hupi-recovery", Status: common.UserStatusEnabled, Quota: 7}
	require.NoError(t, db.Create(user).Error)
	oldQuota := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		common.QuotaPerUnit = oldQuota
		require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&model.UserSubscription{}).Error)
		require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&model.SubscriptionOrder{}).Error)
		require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&model.TopUp{}).Error)
		require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&model.Log{}).Error)
		require.NoError(t, db.Unscoped().Delete(user).Error)
	})
	return db, user
}

func hupijiaoTestOrder(t *testing.T, db *gorm.DB, user *model.User, name, status string, created int64) *model.TopUp {
	t.Helper()
	order := &model.TopUp{UserId: user.Id, Amount: 2000, Money: 20, TradeNo: "hupi-recovery-" + name, OpenOrderId: "provider-" + name, PaymentMethod: model.PaymentMethodAlipay, PaymentProvider: model.PaymentProviderHupijiao, Status: status, CreateTime: created}
	require.NoError(t, db.Create(order).Error)
	return order
}

func hupijiaoTestClient(t *testing.T, transport hupijiaoTestTransport) {
	t.Helper()
	if service.GetHttpClient() == nil {
		service.InitHttpClient()
	}
	client := service.GetHttpClient()
	previous := client.Transport
	client.Transport = transport
	t.Cleanup(func() { client.Transport = previous })
}

func hupijiaoTestResponse(t *testing.T, request *http.Request, trade, openid, status string, amount any) (*http.Response, error) {
	t.Helper()
	assert.Equal(t, "https://api.xunhupay.com/payment/query.html", request.URL.String())
	_, hasDeadline := request.Context().Deadline()
	assert.True(t, hasDeadline)
	body, err := common.Marshal(map[string]any{"errcode": 0, "data": map[string]any{"out_trade_order": trade, "open_order_id": openid, "status": status, "total_amount": amount}})
	require.NoError(t, err)
	return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(string(body))), Header: make(http.Header)}, nil
}

func TestHupijiaoLatePaidCallbacksSettleExactlyOnce(t *testing.T) {
	db, user := hupijiaoRecoveryDB(t)
	previousSecret := setting.HupijiaoAppSecret
	setting.HupijiaoAppSecret = "test-callback-secret"
	t.Cleanup(func() { setting.HupijiaoAppSecret = previousSecret })
	for _, kind := range []string{"wallet", "subscription"} {
		for _, status := range []string{common.TopUpStatusPending, common.TopUpStatusExpired} {
			t.Run(kind+"-"+status, func(t *testing.T) {
				order := hupijiaoTestOrder(t, db, user, kind+status, status, time.Now().Add(-time.Hour).Unix())
				if kind == "subscription" {
					plan := &model.SubscriptionPlan{Title: "payment recovery", PriceAmount: 20, PriceCNY: 20, Currency: "USD", DurationUnit: model.SubscriptionDurationMonth, DurationValue: 1, TotalAmount: 1000, Enabled: true}
					require.NoError(t, db.Create(plan).Error)
					t.Cleanup(func() { require.NoError(t, db.Delete(plan).Error) })
					require.NoError(t, db.Create(&model.SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, TradeNo: order.TradeNo, Money: 20, PaymentMethod: order.PaymentMethod, PaymentProvider: order.PaymentProvider, Status: status, CreateTime: order.CreateTime}).Error)
					require.NoError(t, db.Model(order).Update("amount", 0).Error)
				}
				params := map[string]string{"trade_order_id": order.TradeNo, "total_fee": "20.00", "status": "OD", "open_order_id": order.OpenOrderId}
				params["hash"] = generateHupijiaoSignature(params, setting.HupijiaoAppSecret)
				form := url.Values{}
				for key, value := range params {
					form.Set(key, value)
				}
				invalid := url.Values{}
				for key, values := range form {
					invalid[key] = values
				}
				invalid.Set("hash", "invalid-signature")
				recorder := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(recorder)
				c.Request = httptest.NewRequest(http.MethodPost, "/api/hupijiao/webhook", strings.NewReader(invalid.Encode()))
				c.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
				HupijiaoWebhook(c)
				assert.Equal(t, http.StatusForbidden, recorder.Code)
				// Concurrent duplicate callbacks exercise the database lock, rather
				// than acknowledging an in-flight process before its commit.
				var wg sync.WaitGroup
				results := make(chan *httptest.ResponseRecorder, 2)
				for range 2 {
					wg.Go(func() {
						recorder := httptest.NewRecorder()
						c, _ := gin.CreateTestContext(recorder)
						c.Request = httptest.NewRequest(http.MethodPost, "/api/hupijiao/webhook", strings.NewReader(form.Encode()))
						c.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
						HupijiaoWebhook(c)
						results <- recorder
					})
				}
				wg.Wait()
				close(results)
				for r := range results {
					assert.Equal(t, http.StatusOK, r.Code, r.Body.String())
					assert.Equal(t, "success", r.Body.String())
				}
				var saved model.TopUp
				require.NoError(t, db.First(&saved, order.Id).Error)
				assert.Equal(t, common.TopUpStatusSuccess, saved.Status)
				assert.Positive(t, saved.CompleteTime)
			})
		}
	}
	var savedUser model.User
	require.NoError(t, db.First(&savedUser, user.Id).Error)
	assert.Equal(t, 20_000_007, savedUser.Quota)
	var count int64
	require.NoError(t, db.Model(&model.UserSubscription{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.EqualValues(t, 2, count)
	require.NoError(t, db.Model(&model.Log{}).Where("user_id = ? AND type = ?", user.Id, model.LogTypeTopup).Count(&count).Error)
	assert.EqualValues(t, 2, count)
}

func TestHupijiaoQueryRejectsInvalidProviderResponses(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		code       int
	}{
		{"http error", `{"errcode":0,"data":{"status":"OD"}}`, 502},
		{"missing error code", `{"data":{"status":"OD"}}`, 200},
		{"provider error", `{"errcode":400}`, 200},
		{"missing identifiers", `{"errcode":0,"data":{"status":"OD","total_amount":"20"}}`, 200},
		{"conflicting identifiers", `{"errcode":0,"data":{"status":"OD","out_trade_order":"a","trade_order_id":"b","open_order_id":"p","total_amount":"20"}}`, 200},
		{"invalid amount", `{"errcode":0,"data":{"status":"OD","out_trade_order":"a","open_order_id":"p","total_amount":"NaN"}}`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: tc.code, Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			_, err := queryHupijiaoOrderStatus(context.Background(), "p")
			require.Error(t, err)
		})
	}
	t.Run("cancellation", func(t *testing.T) {
		hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) { return nil, r.Context().Err() })
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := queryHupijiaoOrderStatus(ctx, "p")
		require.ErrorIs(t, err, context.Canceled)
	})
}

func TestHupijiaoPollingNeverReportsFailedSettlementAsPaid(t *testing.T) {
	db, user := hupijiaoRecoveryDB(t)
	for _, tc := range []struct {
		name, status, responseTrade, responseID, paid, amount string
		wallet                                                int
		wantCode                                              int
	}{
		{name: "paid expired", status: common.TopUpStatusExpired, paid: "OD", amount: "20", wallet: 7, wantCode: 200},
		{name: "unpaid", status: common.TopUpStatusExpired, paid: "WP", amount: "20", wallet: 7, wantCode: 200},
		{name: "wrong merchant order", status: common.TopUpStatusPending, responseTrade: "another-order", paid: "OD", amount: "20", wallet: 7, wantCode: 502},
		{name: "wrong provider order", status: common.TopUpStatusPending, responseID: "another-provider-id", paid: "OD", amount: "20", wallet: 7, wantCode: 502},
		{name: "underpayment", status: common.TopUpStatusPending, paid: "OD", amount: "19", wallet: 7, wantCode: 502},
		{name: "wallet ceiling", status: common.TopUpStatusPending, paid: "OD", amount: "20", wallet: common.MaxWalletQuota, wantCode: 502},
		{name: "cancelled", status: "cancelled", paid: "OD", amount: "20", wallet: 7, wantCode: 502},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.NoError(t, db.Model(user).Update("quota", tc.wallet).Error)
			order := hupijiaoTestOrder(t, db, user, tc.name, tc.status, time.Now().Add(-time.Hour).Unix())
			trade, openid := order.TradeNo, order.OpenOrderId
			if tc.responseTrade != "" {
				trade = tc.responseTrade
			}
			if tc.responseID != "" {
				openid = tc.responseID
			}
			hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) {
				return hupijiaoTestResponse(t, r, trade, openid, tc.paid, tc.amount)
			})
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set("id", user.Id)
			c.Params = gin.Params{{Key: "trade_no", Value: order.TradeNo}}
			c.Request = httptest.NewRequest(http.MethodGet, "/status", nil)
			GetTopUpOrderStatus(c)
			assert.Equal(t, tc.wantCode, recorder.Code, recorder.Body.String())
			var response struct {
				Success bool `json:"success"`
				Data    struct {
					Paid bool `json:"paid"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			wantPaid := tc.name == "paid expired"
			assert.Equal(t, wantPaid, response.Data.Paid)
			var saved model.User
			require.NoError(t, db.First(&saved, user.Id).Error)
			wantQuota := tc.wallet
			if wantPaid {
				wantQuota += 10_000_000
			}
			assert.Equal(t, wantQuota, saved.Quota)
		})
	}
}

func TestHupijiaoBackgroundRecoversMissedCallbackAndRetries(t *testing.T) {
	db, user := hupijiaoRecoveryDB(t)
	order := hupijiaoTestOrder(t, db, user, "background", common.TopUpStatusExpired, time.Now().Add(-time.Hour).Unix())
	unpaid := hupijiaoTestOrder(t, db, user, "background-unpaid", common.TopUpStatusPending, time.Now().Add(-time.Minute).Unix())
	fail := true
	hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) {
		if fail {
			return nil, fmt.Errorf("temporary provider outage")
		}
		var request map[string]string
		require.NoError(t, common.DecodeJson(r.Body, &request))
		if request["open_order_id"] == unpaid.OpenOrderId {
			return hupijiaoTestResponse(t, r, unpaid.TradeNo, unpaid.OpenOrderId, "WP", 20)
		}
		return hupijiaoTestResponse(t, r, order.TradeNo, order.OpenOrderId, "OD", "20.00")
	})
	result, err := runHupijiaoReconciliation(context.Background(), 0)
	require.Error(t, err)
	assert.Equal(t, 2, result.Failed)
	assert.Zero(t, result.Settled)
	fail = false
	result, err = runHupijiaoReconciliation(context.Background(), result.NextID)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Settled)
	result, err = runHupijiaoReconciliation(context.Background(), result.NextID)
	require.NoError(t, err)
	assert.Zero(t, result.Settled)
	var saved model.User
	require.NoError(t, db.First(&saved, user.Id).Error)
	assert.Equal(t, 10_000_007, saved.Quota)
	require.NoError(t, db.First(unpaid, unpaid.Id).Error)
	assert.Equal(t, common.TopUpStatusPending, unpaid.Status)
}

func TestHupijiaoSubscriptionPollingRecoversExpiredPayment(t *testing.T) {
	db, user := hupijiaoRecoveryDB(t)
	order := hupijiaoTestOrder(t, db, user, "subscription-poll", common.TopUpStatusExpired, time.Now().Add(-time.Hour).Unix())
	plan := &model.SubscriptionPlan{Title: "subscription poll", Currency: "USD", DurationUnit: model.SubscriptionDurationDay, DurationValue: 1, TotalAmount: 1000}
	require.NoError(t, db.Create(plan).Error)
	t.Cleanup(func() { require.NoError(t, db.Delete(plan).Error) })
	require.NoError(t, db.Model(order).Update("amount", 0).Error)
	require.NoError(t, db.Create(&model.SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, TradeNo: order.TradeNo, Money: 20, PaymentMethod: order.PaymentMethod, PaymentProvider: order.PaymentProvider, Status: common.TopUpStatusExpired, CreateTime: order.CreateTime}).Error)
	hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) {
		return hupijiaoTestResponse(t, r, order.TradeNo, order.OpenOrderId, "OD", "20.00")
	})
	for _, userID := range []int{user.Id + 1, user.Id, user.Id} {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Set("id", userID)
		c.Params = gin.Params{{Key: "trade_no", Value: order.TradeNo}}
		c.Request = httptest.NewRequest(http.MethodGet, "/subscription/status", nil)
		GetSubscriptionOrderStatus(c)
		if userID != user.Id {
			assert.Equal(t, http.StatusForbidden, recorder.Code)
			continue
		}
		assert.Equal(t, http.StatusOK, recorder.Code)
		assert.Contains(t, recorder.Body.String(), `"paid":true`)
	}
	var count int64
	require.NoError(t, db.Model(&model.UserSubscription{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.EqualValues(t, 1, count)
	var saved model.User
	require.NoError(t, db.First(&saved, user.Id).Error)
	assert.Equal(t, 7, saved.Quota)
}

func TestHupijiaoReconciliationPagesOnlyRecoverableOrders(t *testing.T) {
	db, user := hupijiaoRecoveryDB(t)
	now := common.GetTimestamp()
	first := hupijiaoTestOrder(t, db, user, "page-first", common.TopUpStatusExpired, now-7200)
	second := hupijiaoTestOrder(t, db, user, "page-second", common.TopUpStatusPending, now-3600)
	hupijiaoTestOrder(t, db, user, "page-done", common.TopUpStatusSuccess, now-3600)
	hupijiaoTestOrder(t, db, user, "page-cancelled", "cancelled", now-3600)
	hupijiaoTestOrder(t, db, user, "page-outside-window", common.TopUpStatusPending, now-8*86400)
	other := hupijiaoTestOrder(t, db, user, "page-other-provider", common.TopUpStatusPending, now-3600)
	require.NoError(t, db.Model(other).Update("payment_provider", model.PaymentProviderStripe).Error)
	orders, err := model.ListUnsettledHupijiaoTopUps(context.Background(), now-7*86400, now, 0, 1)
	require.NoError(t, err)
	require.Len(t, orders, 1)
	assert.Equal(t, first.Id, orders[0].Id)
	orders, err = model.ListUnsettledHupijiaoTopUps(context.Background(), now-7*86400, now, first.Id, 1)
	require.NoError(t, err)
	require.Len(t, orders, 1)
	assert.Equal(t, second.Id, orders[0].Id)
	orders, err = model.ListUnsettledHupijiaoTopUps(context.Background(), now-7*86400, now, second.Id, 1)
	require.NoError(t, err)
	assert.Empty(t, orders)
}

func TestHupijiaoScheduledTaskRecordsCommittedSettlement(t *testing.T) {
	db, user := hupijiaoRecoveryDB(t)
	require.NoError(t, db.AutoMigrate(&model.SystemTask{}, &model.SystemTaskLock{}))
	t.Cleanup(func() {
		require.NoError(t, db.Where("type = ?", hupijiaoReconcileTaskType).Delete(&model.SystemTask{}).Error)
		require.NoError(t, db.Where("type = ?", hupijiaoReconcileTaskType).Delete(&model.SystemTaskLock{}).Error)
	})
	order := hupijiaoTestOrder(t, db, user, "scheduled", common.TopUpStatusExpired, time.Now().Add(-time.Hour).Unix())
	hupijiaoTestClient(t, func(r *http.Request) (*http.Response, error) {
		return hupijiaoTestResponse(t, r, order.TradeNo, order.OpenOrderId, "OD", "20.00")
	})
	handler := hupijiaoReconcileHandler{}
	task, err := model.CreateSystemTask(handler.Type(), handler.NewPayload(), nil)
	require.NoError(t, err)
	claimed, ok, err := model.ClaimSystemTask(task.ID, handler.Type(), "payment-test-runner", common.GetTimestamp()+60)
	require.NoError(t, err)
	require.True(t, ok)
	handler.Run(context.Background(), claimed, "payment-test-runner")
	saved, err := model.GetSystemTaskByTaskID(task.TaskID)
	require.NoError(t, err)
	require.NotNil(t, saved)
	assert.Equal(t, model.SystemTaskStatusSucceeded, saved.Status, saved.Error)
	var result hupijiaoReconcileResult
	require.NoError(t, common.UnmarshalJsonStr(saved.Result, &result))
	assert.Equal(t, 1, result.Checked)
	assert.Equal(t, 1, result.Settled)
	assert.Zero(t, result.Failed)
	assert.Zero(t, result.NextID)
	var savedUser model.User
	require.NoError(t, db.First(&savedUser, user.Id).Error)
	assert.Equal(t, 10_000_007, savedUser.Quota)
}
