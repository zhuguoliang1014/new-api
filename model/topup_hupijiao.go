package model

// Hupijiao top-up — local fork addition. Constants and code are kept here so
// upstream merges only touch the small hook points in topup.go.

import (
	"errors"
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/common"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

const (
	PaymentMethodHupijiao   = "hupijiao"
	PaymentProviderHupijiao = "hupijiao"
)

// normalizeHupijiaoTopUpAmount converts the stored Amount (US-cents-ish) into
// dollars for display. Returns (amount, true) when the topup is Hupijiao;
// otherwise (0, false) so the caller can fall through.
func normalizeHupijiaoTopUpAmount(topUp *TopUp) (float64, bool) {
	if topUp == nil || topUp.PaymentProvider != PaymentProviderHupijiao {
		return 0, false
	}
	return decimal.NewFromInt(topUp.Amount).Div(decimal.NewFromInt(100)).InexactFloat64(), true
}

// inferHupijiaoPaymentCurrency reports CNY when the payment routes through
// Hupijiao. Returns (currency, true) when matched.
func inferHupijiaoPaymentCurrency(method, provider string) (string, bool) {
	if provider == PaymentProviderHupijiao || method == PaymentMethodHupijiao {
		return "CNY", true
	}
	return "", false
}

// RechargeByHupijiao processes Hupijiao payment callback and increases user quota
func RechargeByHupijiao(tradeNo string, amount float64) error {
	if tradeNo == "" {
		return errors.New("未提供订单号")
	}

	var topUp TopUp
	var quotaToAdd int

	refCol := "`trade_no`"
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		refCol = `"trade_no"`
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		err := lockForUpdate(tx).Where(refCol+" = ?", tradeNo).First(&topUp).Error
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrTopUpNotFound
			}
			return fmt.Errorf("查询订单失败: %w", err)
		}

		if topUp.PaymentProvider != PaymentProviderHupijiao {
			return ErrPaymentMethodMismatch
		}

		if topUp.Status == common.TopUpStatusSuccess {
			return nil
		}

		if topUp.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}

		if math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0 || math.IsNaN(topUp.Money) || math.IsInf(topUp.Money, 0) || topUp.Money <= 0 {
			return errors.New("无效的支付金额")
		}
		if amount < topUp.Money-0.01 {
			return fmt.Errorf("支付金额不足: 应付%.2f元, 实际支付%.2f元", topUp.Money, amount)
		}
		if amount > topUp.Money+1.0 {
			return fmt.Errorf("支付金额异常: 应付%.2f元, 实际支付%.2f元", topUp.Money, amount)
		}

		// topUp.Amount：虎皮椒配额订单为「美元分」（$1.00=100），与 controller 侧一致；站内配额 = (Amount/100)*QuotaPerUnit
		dUsd := decimal.NewFromInt(topUp.Amount).Div(decimal.NewFromInt(100))
		if math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) || common.QuotaPerUnit <= 0 {
			return ErrInvalidTopUpQuota
		}
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		quotaToAdd, err = common.WalletQuotaFromDecimalStrict(dUsd.Mul(dQuotaPerUnit))
		if err != nil || quotaToAdd <= 0 {
			return ErrInvalidTopUpQuota
		}

		topUp.CompleteTime = common.GetTimestamp()
		topUp.Status = common.TopUpStatusSuccess
		if err := tx.Save(&topUp).Error; err != nil {
			return fmt.Errorf("更新订单失败: %w", err)
		}

		return creditTopUpQuota(tx, topUp.UserId, quotaToAdd, nil)
	})

	if err != nil {
		common.SysError("hupijiao topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if quotaToAdd > 0 {
		syncCreditUserQuotaCache(topUp.UserId, quotaToAdd, "hupijiao topup")
		RecordTopupLog(topUp.UserId, fmt.Sprintf("支付宝充值 %.2f 元", topUp.Money), "", topUp.PaymentMethod, PaymentMethodHupijiao)
		UpgradeUserGroupOnTopup(topUp.UserId)
	}

	return nil
}
