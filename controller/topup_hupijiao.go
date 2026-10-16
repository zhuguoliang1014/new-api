package controller

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/system_setting"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

// HupijiaoPayRequest 虎皮椒支付请求；amount 为购买的美元额度（可两位小数），与 TopUp.Amount（美元分）一致。
type HupijiaoPayRequest struct {
	Amount *float64 `json:"amount"`
}

// HupijiaoPayResponse 虎皮椒支付响应
type HupijiaoPayResponse struct {
	OrderId   string `json:"order_id"`
	QrcodeUrl string `json:"qrcode_url"` // PC端二维码
	PayUrl    string `json:"pay_url"`    // 手机端跳转链接
	TradeNo   string `json:"trade_no"`
}

const hupijiaoPaymentExpireSeconds int64 = 3 * 60

func resolveHupijiaoApiURL() string {
	if strings.TrimSpace(setting.HupijiaoApiUrl) != "" {
		return strings.TrimSpace(setting.HupijiaoApiUrl)
	}
	return "https://api.xunhupay.com/payment/do.html"
}

func resolveHupijiaoNotifyURL() string {
	if strings.TrimSpace(setting.HupijiaoNotifyUrl) != "" {
		return strings.TrimSpace(setting.HupijiaoNotifyUrl)
	}
	return strings.TrimRight(system_setting.ServerAddress, "/") + "/api/hupijiao/webhook"
}

func resolveHupijiaoReturnURL() string {
	if strings.TrimSpace(setting.HupijiaoReturnUrl) != "" {
		return strings.TrimSpace(setting.HupijiaoReturnUrl)
	}
	return strings.TrimRight(system_setting.ServerAddress, "/") + "/console/topup?show_history=true"
}

// generateHupijiaoSignature 生成虎皮椒签名
// 参数字典序排序 + MD5(stringA + APPSECRET)
func generateHupijiaoSignature(params map[string]string, appSecret string) string {
	// 提取所有key并排序（字典序）
	keys := make([]string, 0, len(params))
	for k := range params {
		// 跳过hash参数和空值
		if k == "hash" || params[k] == "" {
			continue
		}
		keys = append(keys, k)
	}
	slices.Sort(keys)

	// 按 key=value 格式拼接
	var parts []string
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", k, params[k]))
	}
	stringA := strings.Join(parts, "&")

	// 拼接密钥并MD5
	stringSignTemp := stringA + appSecret
	return common.Md5([]byte(stringSignTemp))
}

// hupijiaoMinQuotaHintMsg 按最低人民币 ÷ 价格系数算出单笔最少要买多少美元额度（与 topup/info 一致）。
func hupijiaoMinQuotaHintMsg() string {
	if math.IsNaN(setting.HupijiaoPrice) || math.IsInf(setting.HupijiaoPrice, 0) || setting.HupijiaoPrice <= 0 {
		return "请先配置虎皮椒价格系数"
	}
	minUsd := formatHupijiaoMinQuotaFromCents(computeMinHupijiaoRechargeAmount())
	return fmt.Sprintf("购买额度至少 %s 美元", minUsd)
}

// bindHupijiaoTopupQuotaCents 解析 JSON 中的美元额度，返回美分；msg 非空时表示应返回给前端的友好中文错误。
func bindHupijiaoTopupQuotaCents(c *gin.Context) (usdCents int64, msg string) {
	var req HupijiaoPayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		return 0, "请求格式有误，例如：{\"amount\":50}"
	}
	if req.Amount == nil {
		return 0, hupijiaoMinQuotaHintMsg()
	}
	a := *req.Amount
	if math.IsNaN(a) || math.IsInf(a, 0) {
		return 0, hupijiaoMinQuotaHintMsg()
	}
	if a < 0 {
		return 0, "额度不能为负数"
	}
	if a < 0.01 {
		return 0, hupijiaoMinQuotaHintMsg()
	}
	cents, err := parseHupijiaoQuotaToUsdCents(strconv.FormatFloat(a, 'f', -1, 64))
	if err != nil {
		return 0, "充值额度超出系统可表示范围"
	}
	if cents < 1 {
		return 0, hupijiaoMinQuotaHintMsg()
	}
	if math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) || common.QuotaPerUnit <= 0 {
		return 0, "充值额度超出系统可表示范围"
	}
	creditedQuota, err := validateCreditedQuota(decimal.NewFromInt(cents).Div(decimal.NewFromInt(100)).Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil {
		return 0, err.Error()
	}
	if err := model.ValidateTopUpQuotaCapacity(c.GetInt("id"), creditedQuota); err != nil {
		return 0, err.Error()
	}
	return cents, ""
}

// RequestHupijiaoPay 创建虎皮椒支付订单
func RequestHupijiaoPay(c *gin.Context) {
	if !isHupijiaoTopUpEnabled() {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "虎皮椒支付未启用",
		})
		return
	}

	usdCents, badMsg := bindHupijiaoTopupQuotaCents(c)
	if badMsg != "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": badMsg,
		})
		return
	}

	// 获取用户信息
	userId := c.GetInt("id")
	username := c.GetString("username")

	if math.IsNaN(setting.HupijiaoPrice) || math.IsInf(setting.HupijiaoPrice, 0) || setting.HupijiaoPrice <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "未配置虎皮椒价格系数（HupijiaoPrice），请在系统设置中填写大于 0 的值",
		})
		return
	}

	// 最低额用未 Round 的精确实付比较，避免 49.98×0.2=9.996 被显示成 10.00 却算作满足最低 10 元
	payYuanRaw := hupijiaoPayYuanRawDecimal(usdCents)
	dMinTop := decimal.NewFromInt(int64(setting.HupijiaoMinTopUp))
	if payYuanRaw.Cmp(dMinTop) < 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": hupijiaoMinQuotaHintMsg(),
		})
		return
	}
	payMoney := payYuanRaw.Round(2).InexactFloat64()
	if math.IsNaN(payMoney) || math.IsInf(payMoney, 0) || payMoney <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效的支付金额"})
		return
	}

	// 生成唯一订单号
	tradeNo := fmt.Sprintf("HUPI%d%d", userId, time.Now().UnixNano()/1e6)

	// 创建待支付订单
	topUp := &model.TopUp{
		UserId:          userId,
		Amount:          usdCents,
		Money:           payMoney,
		TradeNo:         tradeNo,
		PaymentMethod:   model.PaymentMethodAlipay,
		PaymentProvider: model.PaymentProviderHupijiao,
		CreateTime:      time.Now().Unix(),
		Status:          common.TopUpStatusPending,
	}

	err := topUp.Insert()
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒订单创建失败 user_id=%d err=%v", userId, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "创建订单失败",
		})
		return
	}

	// 调用虎皮椒API创建支付订单
	payLink, qrcodeUrl, openId, err := createHupijiaoPayment(tradeNo, payMoney, username)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒API调用失败 trade_no=%s err=%v", tradeNo, err))
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": "创建支付失败: " + err.Error(),
		})
		return
	}

	// 保存虎皮椒平台订单号到数据库
	if openId != "" {
		topUp.OpenOrderId = openId
		topUp.PayUrl = payLink
		topUp.QrcodeUrl = qrcodeUrl
		if err := topUp.UpdateOpenOrderID(); err != nil {
			logger.LogError(c.Request.Context(), fmt.Sprintf("保存虎皮椒平台订单号失败 trade_no=%s err=%v", tradeNo, err))
			c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存支付订单失败，请稍后重试"})
			return
		}
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("虎皮椒订单创建成功 user_id=%d trade_no=%s openid=%s amount=%.2f", userId, tradeNo, openId, payMoney))

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": HupijiaoPayResponse{
			OrderId:   openId,
			QrcodeUrl: qrcodeUrl,
			PayUrl:    payLink,
			TradeNo:   tradeNo,
		},
	})
}

// createHupijiaoPayment 调用虎皮椒API创建支付订单
func createHupijiaoPayment(tradeNo string, amount float64, username string) (payUrl, qrcodeUrl, openId string, err error) {
	// 构建请求参数
	nonceStr := fmt.Sprintf("%d", time.Now().UnixNano())
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)

	params := map[string]string{
		"version":        "1.1",
		"appid":          setting.HupijiaoAppId,
		"trade_order_id": tradeNo,
		"total_fee":      fmt.Sprintf("%.2f", amount),
		"title":          fmt.Sprintf("充值 - %s", username),
		"time":           timestamp,
		"notify_url":     resolveHupijiaoNotifyURL(),
		"return_url":     resolveHupijiaoReturnURL(),
		"nonce_str":      nonceStr,
	}

	// 生成签名
	signature := generateHupijiaoSignature(params, setting.HupijiaoAppSecret)
	params["hash"] = signature

	// 序列化为JSON
	jsonData, err := common.Marshal(params)
	if err != nil {
		return "", "", "", fmt.Errorf("序列化参数失败: %w", err)
	}

	// 发送POST请求
	client := service.GetHttpClient()
	req, err := http.NewRequest("POST", resolveHupijiaoApiURL(), bytes.NewReader(jsonData))
	if err != nil {
		return "", "", "", fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", "", "", fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 读取响应
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", "", fmt.Errorf("读取响应失败: %w", err)
	}

	// 解析响应
	var result map[string]any
	err = common.Unmarshal(body, &result)
	if err != nil {
		return "", "", "", fmt.Errorf("解析响应失败: %w, body=%s", err, string(body))
	}

	// 检查错误码
	errcode := 0
	if ec, ok := result["errcode"].(float64); ok {
		errcode = int(ec)
	}

	if errcode != 0 {
		errmsg := "未知错误"
		if em, ok := result["errmsg"].(string); ok {
			errmsg = em
		}
		return "", "", "", fmt.Errorf("虎皮椒API错误[%d]: %s", errcode, errmsg)
	}

	// 提取支付信息
	if url, ok := result["url"].(string); ok {
		payUrl = url
	}
	if qrcode, ok := result["url_qrcode"].(string); ok {
		qrcodeUrl = qrcode
	}
	// openid 可能是数字或字符串
	if oid, ok := result["openid"].(string); ok {
		openId = oid
	} else if oid, ok := result["openid"].(float64); ok {
		openId = fmt.Sprintf("%.0f", oid)
	}

	if payUrl == "" && qrcodeUrl == "" {
		return "", "", "", fmt.Errorf("虎皮椒API返回数据不完整")
	}

	return payUrl, qrcodeUrl, openId, nil
}

// HupijiaoWebhook acknowledges a paid notification only after settlement commits.
func HupijiaoWebhook(c *gin.Context) {
	// 解析回调参数（Form表单）
	err := c.Request.ParseForm()
	if err != nil {
		logger.LogError(c.Request.Context(), "虎皮椒回调解析表单失败: "+err.Error())
		c.String(http.StatusBadRequest, "fail")
		return
	}

	params := make(map[string]string)
	for k, v := range c.Request.PostForm {
		if len(v) > 0 {
			params[k] = v[0]
		}
	}

	// 提取关键参数
	tradeNo := params["trade_order_id"]
	totalFeeStr := params["total_fee"]
	status := params["status"]
	hash := params["hash"]

	if tradeNo == "" || totalFeeStr == "" {
		logger.LogError(c.Request.Context(), "虎皮椒回调参数缺失")
		c.String(http.StatusBadRequest, "fail")
		return
	}

	// 验证签名
	expectedHash := generateHupijiaoSignature(params, setting.HupijiaoAppSecret)
	if hash != expectedHash {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒回调签名验证失败 trade_no=%s", tradeNo))
		c.String(http.StatusForbidden, "fail")
		return
	}

	// 验证支付状态
	if status != "OD" { // OD = 已支付
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("虎皮椒回调状态异常 trade_no=%s status=%s", tradeNo, status))
		c.String(http.StatusOK, "success") // 仍返回success防止重试
		return
	}

	// 解析金额
	totalFee, err := strconv.ParseFloat(totalFeeStr, 64)
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒回调金额格式错误 trade_no=%s amount=%s", tradeNo, totalFeeStr))
		c.String(http.StatusBadRequest, "fail")
		return
	}

	delete(params, "hash")
	payloadBytes, _ := common.Marshal(params)
	err = completeHupijiaoPaidOrder(tradeNo, totalFee, string(payloadBytes))
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒充值处理失败 trade_no=%s err=%v", tradeNo, err))
		c.String(http.StatusInternalServerError, "fail")
		return
	}

	logger.LogInfo(c.Request.Context(), fmt.Sprintf("虎皮椒充值成功 trade_no=%s amount=%.2f", tradeNo, totalFee))
	c.String(http.StatusOK, "success")
}

func completeHupijiaoPaidOrder(tradeNo string, amount float64, providerPayload string) error {
	if order := model.GetSubscriptionOrderByTradeNo(tradeNo); order != nil {
		return model.CompleteHupijiaoSubscriptionOrder(tradeNo, amount, providerPayload)
	}
	return model.RechargeByHupijiao(tradeNo, amount)
}

func expireTopUpOrderIfTimedOut(topUp *model.TopUp) bool {
	if topUp == nil || topUp.Status != common.TopUpStatusPending {
		return false
	}
	if topUp.CreateTime+hupijiaoPaymentExpireSeconds > common.GetTimestamp() {
		return false
	}
	if err := model.ExpireUnpaidOrder(topUp.TradeNo, topUp.PaymentProvider); err != nil {
		common.SysError(fmt.Sprintf("expire pending topup order failed trade_no=%s err=%v", topUp.TradeNo, err))
		return false
	}
	topUp.Status = common.TopUpStatusExpired
	topUp.CompleteTime = common.GetTimestamp()
	return true
}

// RequestHupijiaoAmount 获取虎皮椒支付金额（应用折扣）
func RequestHupijiaoAmount(c *gin.Context) {
	if !isHupijiaoTopUpEnabled() {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "虎皮椒支付未启用",
		})
		return
	}

	usdCents, badMsg := bindHupijiaoTopupQuotaCents(c)
	if badMsg != "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": badMsg,
		})
		return
	}

	if math.IsNaN(setting.HupijiaoPrice) || math.IsInf(setting.HupijiaoPrice, 0) || setting.HupijiaoPrice <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "未配置虎皮椒价格系数（HupijiaoPrice）",
		})
		return
	}

	payYuanRaw := hupijiaoPayYuanRawDecimal(usdCents)
	dMinTop := decimal.NewFromInt(int64(setting.HupijiaoMinTopUp))
	if payYuanRaw.Cmp(dMinTop) < 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": hupijiaoMinQuotaHintMsg(),
		})
		return
	}

	payMoney := getHupijiaoPayMoneyUsdCents(usdCents)
	if math.IsNaN(payMoney) || math.IsInf(payMoney, 0) || payMoney <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效的支付金额"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data": gin.H{
			"amount": payMoney,
			"money":  float64(usdCents) / 100.0,
		},
	})
}

// CancelTopUpOrder 取消待支付订单
func CancelTopUpOrder(c *gin.Context) {
	userId := c.GetInt("id")
	tradeNo := c.Param("trade_no")

	if tradeNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": "订单号不能为空",
		})
		return
	}

	// 查询订单
	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"success": false,
			"message": "订单不存在",
		})
		return
	}

	// 验证订单所属
	if topUp.UserId != userId {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"message": "无权操作此订单",
		})
		return
	}

	closeOrder(c, topUp)
}

type hupijiaoOrderStatusResult struct {
	Paid        bool
	Amount      float64
	TradeNo     string
	OpenOrderId string
}

// queryHupijiaoOrderStatus 调用虎皮椒API查询订单状态
// 注意：必须使用 openid (虎皮椒返回的订单ID) 而不是 trade_order_id
func queryHupijiaoOrderStatus(ctx context.Context, openid string) (*hupijiaoOrderStatusResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	params := map[string]string{
		"appid":         setting.HupijiaoAppId,
		"open_order_id": openid,
		"time":          strconv.FormatInt(time.Now().Unix(), 10),
		"nonce_str":     strconv.FormatInt(time.Now().UnixNano(), 10),
	}
	params["hash"] = generateHupijiaoSignature(params, setting.HupijiaoAppSecret)
	body, err := common.Marshal(params)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.xunhupay.com/payment/query.html", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := service.GetHttpClient().Do(req)
	if err != nil {
		return nil, fmt.Errorf("查询支付平台失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("支付平台 HTTP %d", resp.StatusCode)
	}
	body, err = io.ReadAll(io.LimitReader(resp.Body, 1<<20+1))
	if err != nil {
		return nil, err
	}
	if len(body) > 1<<20 {
		return nil, fmt.Errorf("支付平台响应过大")
	}
	var result struct {
		Errcode *int `json:"errcode"`
		Data    struct {
			Status        string `json:"status"`
			TradeNo       string `json:"out_trade_order"`
			LegacyTradeNo string `json:"trade_order_id"`
			OpenOrderID   string `json:"open_order_id"`
			TotalAmount   any    `json:"total_amount"`
			TotalFee      any    `json:"total_fee"`
		} `json:"data"`
	}
	if err := common.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("支付平台响应格式错误: %w", err)
	}
	if result.Errcode == nil {
		return nil, fmt.Errorf("支付平台响应缺少错误码")
	}
	if *result.Errcode != 0 {
		return nil, fmt.Errorf("支付平台错误码 %d", *result.Errcode)
	}
	data := result.Data
	if data.TradeNo == "" {
		data.TradeNo = data.LegacyTradeNo
	}
	if data.LegacyTradeNo != "" && data.LegacyTradeNo != data.TradeNo {
		return nil, fmt.Errorf("支付平台订单标识冲突")
	}
	if data.TradeNo == "" || data.OpenOrderID == "" || data.Status == "" {
		return nil, fmt.Errorf("支付平台响应缺少订单标识或状态")
	}
	amountValue := data.TotalAmount
	if amountValue == nil {
		amountValue = data.TotalFee
	}
	amount, err := strconv.ParseFloat(fmt.Sprint(amountValue), 64)
	if err != nil || math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 {
		return nil, fmt.Errorf("支付平台金额无效")
	}
	return &hupijiaoOrderStatusResult{Paid: data.Status == "OD", Amount: amount, TradeNo: data.TradeNo, OpenOrderId: data.OpenOrderID}, nil
}

// reconcileHupijiaoOrder settles only the exact provider order stored locally.
// Success means the database transaction committed, including quota/subscription issuance.
func reconcileHupijiaoOrder(ctx context.Context, topUp *model.TopUp, source string) (bool, error) {
	if topUp.PaymentProvider != model.PaymentProviderHupijiao {
		return false, model.ErrPaymentMethodMismatch
	}
	if topUp.Status == common.TopUpStatusSuccess {
		return true, nil
	}
	if topUp.Status != common.TopUpStatusPending && topUp.Status != common.TopUpStatusExpired && topUp.Status != common.TopUpStatusCanceled {
		return false, model.ErrTopUpStatusInvalid
	}
	if topUp.OpenOrderId == "" {
		return false, nil
	}
	status, err := queryHupijiaoOrderStatus(ctx, topUp.OpenOrderId)
	if err != nil {
		return false, err
	}
	if status.TradeNo != topUp.TradeNo || status.OpenOrderId != topUp.OpenOrderId {
		return false, fmt.Errorf("支付平台订单号不匹配")
	}
	if !status.Paid {
		return false, nil
	}
	payload, err := common.Marshal(map[string]string{"source": source, "open_order_id": status.OpenOrderId})
	if err != nil {
		return false, err
	}
	if err := completeHupijiaoPaidOrder(topUp.TradeNo, status.Amount, string(payload)); err != nil {
		return false, err
	}
	logger.LogInfo(ctx, fmt.Sprintf("虎皮椒查单结算成功 source=%s trade_no=%s", source, topUp.TradeNo))
	return true, nil
}

// GetTopUpOrderStatus 查询订单状态（主动查询虎皮椒平台）
func GetTopUpOrderStatus(c *gin.Context) {
	tradeNo := c.Param("trade_no")
	if tradeNo == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "订单号不能为空"})
		return
	}
	topUp := model.GetTopUpByTradeNo(tradeNo)
	if topUp == nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "订单不存在"})
		return
	}
	if topUp.UserId != c.GetInt("id") {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "无权查看此订单"})
		return
	}
	if openid := c.Query("openid"); openid != "" && openid != topUp.OpenOrderId {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "订单号不匹配"})
		return
	}
	if topUp.Status == common.TopUpStatusSuccess {
		common.ApiSuccess(c, gin.H{"status": topUp.Status, "paid": true})
		return
	}
	paid, err := verifyOrderPayment(c.Request.Context(), topUp, "poll")
	if err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("虎皮椒查单失败 trade_no=%s err=%v", tradeNo, err))
		c.JSON(http.StatusBadGateway, gin.H{"success": false, "message": "查询或处理支付失败，请稍后重试"})
		return
	}
	if paid {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "订单已支付", "data": gin.H{"status": common.TopUpStatusSuccess, "paid": true}})
		return
	}
	expireTopUpOrderIfTimedOut(topUp)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "订单尚未支付", "data": gin.H{"status": topUp.Status, "paid": false}})
}
