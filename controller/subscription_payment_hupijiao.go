package controller

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

// HupijiaoSubscriptionPayRequest 虎皮椒订阅支付请求
type HupijiaoSubscriptionPayRequest struct {
	PlanId int `json:"plan_id" binding:"required"`
}

// SubscriptionRequestHupijiao 创建虎皮椒订阅支付订单
func SubscriptionRequestHupijiao(c *gin.Context) {
	if !isHupijiaoTopUpEnabled() {
		common.ApiErrorMsg(c, "虎皮椒支付未启用")
		return
	}

	var req HupijiaoSubscriptionPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	userId := c.GetInt("id")
	username := c.GetString("username")

	// 获取套餐信息
	plan, err := model.GetSubscriptionPlanById(req.PlanId)
	if err != nil {
		common.ApiErrorMsg(c, "套餐不存在")
		return
	}

	if !plan.Enabled {
		common.ApiErrorMsg(c, "套餐已下架")
		return
	}
	if msg := saleWindowErrorMessage(plan); msg != "" {
		common.ApiErrorMsg(c, msg)
		return
	}

	if plan.MaxPurchasePerUser > 0 {
		count, err := model.CountUserSubscriptionsByPlan(userId, plan.Id)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if count >= int64(plan.MaxPurchasePerUser) {
			common.ApiErrorMsg(c, "已达到该套餐购买上限")
			return
		}
	}

	if plan.PriceCNY <= 0 {
		common.ApiErrorMsg(c, "该套餐未配置人民币价格，无法使用支付宝支付")
		return
	}

	// 使用套餐配置的人民币价格
	payMoney := plan.PriceCNY

	// 生成订单号
	tradeNo := fmt.Sprintf("HUPS%d%d", userId, time.Now().UnixNano()/1e6)

	// 创建订阅支付订单
	order := &model.SubscriptionOrder{
		UserId:          userId,
		PlanId:          plan.Id,
		Money:           payMoney,
		TradeNo:         tradeNo,
		PaymentMethod:   model.SubscriptionPaymentMethodAlipay,
		PaymentProvider: model.SubscriptionPaymentProviderHupijiao,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}

	err = order.Insert()
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒订阅订单创建失败 user_id=%d err=%v", userId, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "创建订单失败",
		})
		return
	}

	topUp := &model.TopUp{
		UserId:          userId,
		Amount:          0,
		Money:           payMoney,
		TradeNo:         tradeNo,
		PaymentMethod:   model.PaymentMethodAlipay,
		PaymentProvider: model.PaymentProviderHupijiao,
		CreateTime:      order.CreateTime,
		Status:          common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒订阅账单订单创建失败 user_id=%d trade_no=%s err=%v", userId, tradeNo, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "创建订单失败",
		})
		return
	}

	// 调用支付API（使用人民币金额）
	payUrl, qrcodeUrl, openId, err := createHupijiaoPayment(
		tradeNo,
		payMoney,
		fmt.Sprintf("订阅套餐 - %s - %s", plan.Title, username),
	)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒订阅API调用失败 trade_no=%s err=%v", tradeNo, err))
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "创建支付失败: " + err.Error()})
		return
	}

	if openId != "" {
		topUp.OpenOrderId = openId
		if err := topUp.UpdateOpenOrderID(); err != nil {
			logger.LogError(c.Request.Context(), fmt.Sprintf("保存虎皮椒平台订单号失败 trade_no=%s err=%v", tradeNo, err))
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存支付订单失败，请稍后重试"})
			return
		}
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("虎皮椒订阅订单创建成功 user_id=%d trade_no=%s plan=%s", userId, tradeNo, plan.Title))

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"order_id":   openId,
			"qrcode_url": qrcodeUrl,
			"pay_url":    payUrl,
			"trade_no":   tradeNo,
		},
	})
}

// HupijiaoSubscriptionWebhook 虎皮椒订阅支付回调
func HupijiaoSubscriptionWebhook(c *gin.Context) {
	// 解析回调参数
	err := c.Request.ParseForm()
	if err != nil {
		logger.LogError(c.Request.Context(), "虎皮椒订阅回调解析表单失败: "+err.Error())
		c.String(http.StatusBadRequest, "fail")
		return
	}

	params := make(map[string]string)
	for k, v := range c.Request.PostForm {
		if len(v) > 0 {
			params[k] = v[0]
		}
	}

	tradeNo := params["trade_order_id"]
	totalFeeStr := params["total_fee"]
	status := params["status"]
	hash := params["hash"]

	if tradeNo == "" || totalFeeStr == "" {
		logger.LogError(c.Request.Context(), "虎皮椒订阅回调参数缺失")
		c.String(http.StatusBadRequest, "fail")
		return
	}

	// 验证签名
	expectedHash := generateHupijiaoSignature(params, setting.HupijiaoAppSecret)
	if hash != expectedHash {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒订阅回调签名失败 trade_no=%s", tradeNo))
		c.String(http.StatusForbidden, "fail")
		return
	}

	if status != "OD" {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("虎皮椒订阅回调状态异常 trade_no=%s status=%s", tradeNo, status))
		c.String(http.StatusOK, "success")
		return
	}

	totalFee, err := strconv.ParseFloat(totalFeeStr, 64)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒订阅回调金额错误 trade_no=%s", tradeNo))
		c.String(http.StatusBadRequest, "fail")
		return
	}

	// 处理订阅
	providerPayload := fmt.Sprintf(`{"open_order_id":"%s","transaction_id":"%s"}`,
		params["open_order_id"], params["transaction_id"])

	err = model.CompleteHupijiaoSubscriptionOrder(tradeNo, totalFee, providerPayload)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒订阅处理失败 trade_no=%s err=%v", tradeNo, err))
		c.String(http.StatusInternalServerError, "fail")
		return
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("虎皮椒订阅成功 trade_no=%s amount=%.2f", tradeNo, totalFee))
	c.String(http.StatusOK, "success")
}

// GetSubscriptionOrderStatus 查询订阅订单状态（主动查询虎皮椒平台）
func GetSubscriptionOrderStatus(c *gin.Context) {
	userId := c.GetInt("id")
	tradeNo := c.Param("trade_no")

	if tradeNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "参数缺失"})
		return
	}

	order := model.GetSubscriptionOrderByTradeNo(tradeNo)
	if order == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "订单不存在"})
		return
	}

	if order.UserId != userId {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权查看此订单"})
		return
	}

	if order.Status == common.TopUpStatusSuccess {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "订单已支付", "data": gin.H{"paid": true}})
		return
	}

	if order.PaymentProvider != model.SubscriptionPaymentProviderHupijiao {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "该订单不支持查询"})
		return
	}
	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "充值订单不存在"})
		return
	}
	if topUp.UserId != order.UserId {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "订单号不匹配"})
		return
	}
	if openid := c.Query("openid"); openid != "" && openid != topUp.OpenOrderId {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "订单号不匹配"})
		return
	}
	paid, err := reconcileHupijiaoOrder(c.Request.Context(), topUp, "subscription_poll")
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒订阅查单失败 trade_no=%s err=%v", tradeNo, err))
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "查询或处理订阅支付失败，请稍后重试"})
		return
	}
	if !paid {
		expireTopUpOrderIfTimedOut(topUp)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"paid": paid}})
}
