package controller

import (
	"context"
	"fmt"
	"math"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// verifyOrderPayment always uses authenticated provider data and the existing
// settlement path. Admin actions never bypass amount or identity validation.
func verifyOrderPayment(ctx context.Context, order *model.TopUp, source string) (bool, error) {
	switch order.PaymentProvider {
	case model.PaymentProviderHupijiao:
		if order.OpenOrderId == "" {
			return false, nil
		}
		status, err := queryHupijiaoOrderStatus(ctx, order.OpenOrderId)
		if err != nil {
			return false, err
		}
		if status.TradeNo != order.TradeNo || status.OpenOrderId != order.OpenOrderId {
			return false, fmt.Errorf("支付平台订单号不匹配")
		}
		if !status.Paid {
			return false, nil
		}
		if math.IsNaN(order.Money) || math.IsInf(order.Money, 0) || order.Money <= 0 || math.Abs(status.Amount-order.Money) > 0.010000001 {
			return false, fmt.Errorf("支付平台金额与订单不匹配")
		}
		payload, err := common.Marshal(map[string]string{"source": source, "open_order_id": status.OpenOrderId})
		if err != nil {
			return false, err
		}
		return true, completeHupijiaoPaidOrder(order.TradeNo, status.Amount, string(payload))
	case model.PaymentProviderEpay:
		status, err := queryEpayOrder(ctx, order.TradeNo)
		if err != nil || status.Status != 1 {
			return false, err
		}
		payload, err := common.Marshal(map[string]string{"source": source, "trade_no": status.ProviderID})
		if err != nil {
			return false, err
		}
		_, err = completeEpayPaidOrder(order.TradeNo, status.Method, status.Money, string(payload), "")
		return true, err
	default:
		return false, fmt.Errorf("该支付渠道暂不支持主动查单，请联系管理员核实")
	}
}

func closeOrder(c *gin.Context, order *model.TopUp) {
	if order.Status == common.TopUpStatusSuccess {
		common.ApiErrorMsg(c, "已支付订单不能关闭")
		return
	}
	paid, err := verifyOrderPayment(c.Request.Context(), order, "close")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if paid {
		common.ApiSuccess(c, gin.H{"status": common.TopUpStatusSuccess, "paid": true})
		return
	}
	if err := model.CloseUnpaidOrder(order.TradeNo, order.PaymentProvider, nil); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"status": common.TopUpStatusCanceled, "paid": false})
}

func AdminCloseTopUp(c *gin.Context) {
	var req AdminCompleteTopupRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.TradeNo == "" {
		common.ApiErrorMsg(c, "参数错误")
		return
	}
	order := model.GetTopUpByTradeNo(req.TradeNo)
	if order == nil {
		common.ApiErrorMsg(c, "订单不存在")
		return
	}
	closeOrder(c, order)
}

// RepayTopUpOrder resumes a saved checkout. Legacy/expired checkouts get a new
// direct Hupijiao order with the original quote; the old provider ID is retained.
func RepayTopUpOrder(c *gin.Context) {
	if !isHupijiaoTopUpEnabled() {
		common.ApiErrorMsg(c, "虎皮椒支付未启用")
		return
	}
	order := model.GetTopUpByTradeNo(c.Param("trade_no"))
	if order == nil || order.UserId != c.GetInt("id") {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "订单不存在"})
		return
	}
	if order.Status == common.TopUpStatusCanceled {
		common.ApiErrorMsg(c, "订单已取消，请重新下单")
		return
	}
	paid, err := verifyOrderPayment(c.Request.Context(), order, "repay")
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if paid {
		common.ApiSuccess(c, gin.H{"paid": true, "status": common.TopUpStatusSuccess})
		return
	}
	if order.Status != common.TopUpStatusPending && order.Status != common.TopUpStatusExpired {
		common.ApiErrorMsg(c, "订单状态不支持支付")
		return
	}
	if order.PaymentProvider == model.PaymentProviderHupijiao && order.Status == common.TopUpStatusPending && order.CreateTime+hupijiaoPaymentExpireSeconds > common.GetTimestamp() && (order.PayUrl != "" || order.QrcodeUrl != "") {
		common.ApiSuccess(c, gin.H{"trade_no": order.TradeNo, "order_id": order.OpenOrderId, "pay_url": order.PayUrl, "qrcode_url": order.QrcodeUrl, "create_time": order.CreateTime})
		return
	}
	if math.IsNaN(order.Money) || math.IsInf(order.Money, 0) || order.Money <= 0 {
		common.ApiErrorMsg(c, "订单金额无效")
		return
	}
	amount := order.Amount
	if order.PaymentProvider == model.PaymentProviderEpay {
		if amount < 0 || amount > math.MaxInt64/100 {
			common.ApiErrorMsg(c, "订单额度无效")
			return
		}
		amount *= 100
	}
	if model.GetSubscriptionOrderByTradeNo(order.TradeNo) == nil {
		quota, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromInt(amount).Div(decimal.NewFromInt(100)).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
		if err != nil || quota <= 0 {
			common.ApiErrorMsg(c, "订单额度无效")
			return
		}
		if err := model.ValidateTopUpQuotaCapacity(order.UserId, quota); err != nil {
			common.ApiError(c, err)
			return
		}
	}
	replacement := &model.TopUp{UserId: order.UserId, Amount: amount, Money: order.Money, TradeNo: fmt.Sprintf("HUPR%d%s", order.UserId, common.GetRandomString(16)), PaymentProvider: model.PaymentProviderHupijiao, PaymentMethod: model.PaymentMethodAlipay, Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp()}
	if err := model.CloseUnpaidOrder(order.TradeNo, order.PaymentProvider, replacement); err != nil {
		common.ApiError(c, err)
		return
	}
	payURL, qrURL, openID, err := createHupijiaoPayment(replacement.TradeNo, replacement.Money, c.GetString("username"))
	if err != nil {
		common.ApiErrorMsg(c, "创建支付失败，请刷新订单后重试")
		return
	}
	replacement.OpenOrderId, replacement.PayUrl, replacement.QrcodeUrl = openID, payURL, qrURL
	if err := replacement.UpdateOpenOrderID(); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"trade_no": replacement.TradeNo, "order_id": openID, "pay_url": payURL, "qrcode_url": qrURL, "create_time": replacement.CreateTime})
}
