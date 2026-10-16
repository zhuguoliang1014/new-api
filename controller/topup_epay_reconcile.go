package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
)

// completeEpayPaidOrder keeps both native callbacks and authenticated status
// queries on the same settlement path. Quota comes from the original order;
// the provider's CNY amount must match before granting any credit or plan.
func completeEpayPaidOrder(tradeNo, method, paidMoney, payload, callerIP string) (bool, error) {
	amount, err := decimal.NewFromString(paidMoney)
	if err != nil || !amount.IsPositive() {
		return false, fmt.Errorf("invalid epay paid amount")
	}
	order := model.GetSubscriptionOrderByTradeNo(tradeNo)
	var money float64
	if order != nil {
		if order.PaymentProvider != model.PaymentProviderEpay {
			return false, model.ErrPaymentMethodMismatch
		}
		money = order.Money
	} else {
		topUp := model.GetTopUpByTradeNo(tradeNo)
		if topUp == nil {
			return false, model.ErrTopUpNotFound
		}
		if topUp.PaymentProvider != model.PaymentProviderEpay {
			return false, model.ErrPaymentMethodMismatch
		}
		money = topUp.Money
	}
	if money <= 0 || math.IsNaN(money) || math.IsInf(money, 0) || amount.Sub(decimal.NewFromFloat(money)).Abs().GreaterThan(decimal.RequireFromString("0.01")) {
		return false, fmt.Errorf("epay payment amount does not match order")
	}
	if order != nil {
		err := model.CompleteSubscriptionOrder(tradeNo, payload, model.PaymentProviderEpay, method)
		return order.Status == common.TopUpStatusSuccess, err
	}
	return model.RechargeEpay(tradeNo, method, callerIP)
}

type epayQueryResult struct {
	Status     int
	ProviderID string
	Method     string
	Money      string
}

// queryEpayOrder uses the native V1 order query contract, independent of any
// underlying processor such as Hupijiao. Never return errors containing the
// request URL: this API puts the merchant credential in its query string.
func queryEpayOrder(ctx context.Context, tradeNo string) (*epayQueryResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	u, err := url.Parse(strings.TrimRight(operation_setting.PayAddress, "/") + "/api.php")
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return nil, fmt.Errorf("epay reconciliation requires a valid HTTPS gateway")
	}
	u.RawQuery = url.Values{"act": {"order"}, "pid": {operation_setting.EpayId}, "key": {operation_setting.EpayKey}, "out_trade_no": {tradeNo}}.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("cannot create epay order query")
	}
	resp, err := service.GetHttpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("epay order query transport failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("epay order query HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(body) > 1<<20 {
		return nil, fmt.Errorf("cannot read epay query response")
	}
	var response struct {
		Code       *int            `json:"code"`
		Status     json.RawMessage `json:"status"`
		MerchantID any             `json:"pid"`
		TradeNo    string          `json:"out_trade_no"`
		ProviderID string          `json:"trade_no"`
		Method     any             `json:"type"`
		Money      string          `json:"money"`
	}
	if err := common.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("invalid epay query response")
	}
	if response.Code == nil || *response.Code != 1 {
		return nil, fmt.Errorf("epay order query was not successful")
	}
	if response.TradeNo != tradeNo || fmt.Sprint(response.MerchantID) != operation_setting.EpayId || response.ProviderID == "" {
		return nil, fmt.Errorf("epay query order identity mismatch")
	}
	result := epayQueryResult{ProviderID: response.ProviderID, Money: response.Money}
	// Gateways return either JSON integers or strings. Accept only the two
	// documented states; booleans and fractional values must never grant credit.
	switch strings.TrimSpace(string(response.Status)) {
	case "0", `"0"`:
		result.Status = 0
	case "1", `"1"`:
		result.Status = 1
	default:
		return nil, fmt.Errorf("epay query returned an unsupported order status")
	}
	switch method := response.Method.(type) {
	case string:
		result.Method = method
	case nil:
		// No method has been selected yet on an unpaid cashier page.
	case bool:
		if method {
			return nil, fmt.Errorf("epay query returned an invalid payment method")
		}
	default:
		return nil, fmt.Errorf("epay query returned an invalid payment method")
	}
	if result.Status == 1 && strings.TrimSpace(result.Method) == "" {
		return nil, fmt.Errorf("epay paid order has no payment method")
	}
	return &result, nil
}

const epayReconcileTaskType = "epay_reconcile"

type epayReconcileHandler struct{}

type epayReconcileResult struct {
	NextTopUpID        int `json:"next_topup_id"`
	NextSubscriptionID int `json:"next_subscription_id"`
	Checked            int `json:"checked"`
	Settled            int `json:"settled"`
	Failed             int `json:"failed"`
}

func (epayReconcileHandler) Type() string            { return epayReconcileTaskType }
func (epayReconcileHandler) Enabled() bool           { return isEpayWebhookConfigured() }
func (epayReconcileHandler) Interval() time.Duration { return 30 * time.Second }
func (epayReconcileHandler) NewPayload() any {
	var result epayReconcileResult
	last, err := model.GetLatestSystemTask(epayReconcileTaskType)
	if err == nil && last != nil && last.Result != "" {
		err = common.UnmarshalJsonStr(last.Result, &result)
	}
	if err != nil {
		common.SysError("epay reconciliation cursor lookup failed")
	}
	return epayReconcileResult{NextTopUpID: result.NextTopUpID, NextSubscriptionID: result.NextSubscriptionID}
}
func (epayReconcileHandler) Run(ctx context.Context, task *model.SystemTask, runnerID string) {
	var cursor epayReconcileResult
	if err := task.DecodePayload(&cursor); err != nil {
		finishSystemTaskHandler(task, runnerID, model.SystemTaskStatusFailed, nil, err)
		return
	}
	result, err := runEpayReconciliation(ctx, cursor)
	status := model.SystemTaskStatusSucceeded
	if err != nil {
		status = model.SystemTaskStatusFailed
	}
	finishSystemTaskHandler(task, runnerID, status, result, err)
}

func runEpayReconciliation(ctx context.Context, cursor epayReconcileResult) (epayReconcileResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	result := epayReconcileResult{NextTopUpID: cursor.NextTopUpID, NextSubscriptionID: cursor.NextSubscriptionID}
	now := common.GetTimestamp()
	for _, subscription := range []bool{false, true} {
		afterID := result.NextTopUpID
		if subscription {
			afterID = result.NextSubscriptionID
		}
		recent, err := model.ListUnsettledEpayOrders(ctx, subscription, now-15*60, now-5, 0, 100)
		if err != nil {
			return result, err
		}
		older, err := model.ListUnsettledEpayOrders(ctx, subscription, now-7*86400, now-15*60, afterID, 50)
		if err != nil {
			return result, err
		}
		for page, orders := range [][]model.UnsettledEpayOrder{recent, older} {
			for _, order := range orders {
				if err := ctx.Err(); err != nil {
					return result, err
				}
				status, err := queryEpayOrder(ctx, order.TradeNo)
				result.Checked++
				if err == nil && status.Status == 1 {
					payload, marshalErr := common.Marshal(map[string]string{"source": "epay_query", "trade_no": status.ProviderID})
					err = marshalErr
					if err == nil {
						_, err = completeEpayPaidOrder(order.TradeNo, status.Method, status.Money, string(payload), "")
					}
					if err == nil {
						result.Settled++
					}
				}
				if err != nil {
					result.Failed++
					logger.LogWarn(ctx, fmt.Sprintf("epay reconciliation failed trade_no=%s err=%v", order.TradeNo, err))
				}
				if page == 1 {
					if subscription {
						result.NextSubscriptionID = order.Id
					} else {
						result.NextTopUpID = order.Id
					}
				}
			}
		}
		if len(older) < 50 {
			if subscription {
				result.NextSubscriptionID = 0
			} else {
				result.NextTopUpID = 0
			}
		}
	}
	if result.Failed > 0 {
		return result, fmt.Errorf("epay reconciliation: %d of %d checks failed; retry on next sweep", result.Failed, result.Checked)
	}
	return result, nil
}
