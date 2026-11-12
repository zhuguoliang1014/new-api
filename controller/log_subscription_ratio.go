package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
)

func populateLogSubscriptionPurchaseRatios(logs []*model.Log) {
	// Match the wallet plan comparison: native Alipay first, then Hupijiao.
	unitPrice := 0.0
	if isEpayTopUpEnabled() && operation_setting.ContainsPayMethod(model.PaymentMethodAlipay) {
		unitPrice = operation_setting.Price
	} else if isHupijiaoTopUpEnabled() {
		unitPrice = setting.HupijiaoPrice
	}
	if err := model.PopulateSubscriptionPurchaseRatios(logs, unitPrice); err != nil {
		// Purchase metadata is optional; a lookup failure must not hide logs.
		common.SysError(common.LogText("failed to load subscription purchase multipliers: %s", err.Error()))
	}
}
