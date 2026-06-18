package model

// Hupijiao top-up — local fork addition. Constants and code are kept here so
// upstream merges only touch the small hook points in topup.go.

import (
	"errors"
	"fmt"
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting"

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

func calculateHupijiaoInviteRewardQuota(paidCNY float64) int {
	if paidCNY <= 0 || setting.HupijiaoPrice <= 0 || setting.HupijiaoInviteRewardRatio <= 0 || setting.HupijiaoInviteRewardRatio > 1 || common.QuotaPerUnit <= 0 {
		return 0
	}
	if math.IsNaN(paidCNY) || math.IsInf(paidCNY, 0) ||
		math.IsNaN(setting.HupijiaoPrice) || math.IsInf(setting.HupijiaoPrice, 0) ||
		math.IsNaN(setting.HupijiaoInviteRewardRatio) || math.IsInf(setting.HupijiaoInviteRewardRatio, 0) ||
		math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) {
		return 0
	}
	dPaidCNY := decimal.NewFromFloat(paidCNY)
	dRewardRatio := decimal.NewFromFloat(setting.HupijiaoInviteRewardRatio)
	dHupijiaoPrice := decimal.NewFromFloat(setting.HupijiaoPrice)
	dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
	return int(dPaidCNY.Mul(dRewardRatio).Div(dHupijiaoPrice).Mul(dQuotaPerUnit).Round(0).IntPart())
}

func applyHupijiaoInviteRewardTx(tx *gorm.DB, inviteeId int, paidCNY float64) (int, int, error) {
	if tx == nil {
		return 0, 0, errors.New("tx is nil")
	}
	rewardQuota := calculateHupijiaoInviteRewardQuota(paidCNY)
	if rewardQuota <= 0 {
		return 0, 0, nil
	}

	var invitee User
	if err := tx.Select("id", "inviter_id").Where("id = ?", inviteeId).First(&invitee).Error; err != nil {
		return 0, 0, err
	}
	if invitee.InviterId <= 0 {
		return 0, 0, nil
	}

	updates := map[string]interface{}{
		"aff_quota":   gorm.Expr("aff_quota + ?", rewardQuota),
		"aff_history": gorm.Expr("aff_history + ?", rewardQuota),
	}
	result := tx.Model(&User{}).Where("id = ?", invitee.InviterId).Updates(updates)
	if result.Error != nil {
		return 0, 0, result.Error
	}
	if result.RowsAffected == 0 {
		return 0, 0, nil
	}

	return invitee.InviterId, rewardQuota, nil
}

// RechargeByHupijiao processes Hupijiao payment callback and increases user quota
func RechargeByHupijiao(tradeNo string, amount float64) error {
	if tradeNo == "" {
		return errors.New("未提供订单号")
	}

	var topUp TopUp
	var quotaToAdd int
	var inviterId int
	var inviteRewardQuota int

	refCol := "`trade_no`"
	if common.UsingPostgreSQL {
		refCol = `"trade_no"`
	}

	err := DB.Transaction(func(tx *gorm.DB) error {
		err := tx.Set("gorm:query_option", "FOR UPDATE").Where(refCol+" = ?", tradeNo).First(&topUp).Error
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

		if amount < topUp.Money-0.01 {
			return fmt.Errorf("支付金额不足: 应付%.2f元, 实际支付%.2f元", topUp.Money, amount)
		}
		if amount > topUp.Money+1.0 {
			return fmt.Errorf("支付金额异常: 应付%.2f元, 实际支付%.2f元", topUp.Money, amount)
		}

		// topUp.Amount：虎皮椒配额订单为「美元分」（$1.00=100），与 controller 侧一致；站内配额 = (Amount/100)*QuotaPerUnit
		dUsd := decimal.NewFromInt(topUp.Amount).Div(decimal.NewFromInt(100))
		dQuotaPerUnit := decimal.NewFromFloat(common.QuotaPerUnit)
		quotaToAdd = int(dUsd.Mul(dQuotaPerUnit).Round(0).IntPart())
		if quotaToAdd <= 0 {
			return errors.New("无效的充值额度")
		}

		topUp.CompleteTime = common.GetTimestamp()
		topUp.Status = common.TopUpStatusSuccess
		if err := tx.Save(&topUp).Error; err != nil {
			return fmt.Errorf("更新订单失败: %w", err)
		}

		if err := tx.Model(&User{}).Where("id = ?", topUp.UserId).Update("quota", gorm.Expr("quota + ?", quotaToAdd)).Error; err != nil {
			return fmt.Errorf("增加配额失败: %w", err)
		}

		var rewardErr error
		inviterId, inviteRewardQuota, rewardErr = applyHupijiaoInviteRewardTx(tx, topUp.UserId, amount)
		if rewardErr != nil {
			return fmt.Errorf("增加邀请奖励失败: %w", rewardErr)
		}

		return nil
	})

	if err != nil {
		common.SysError("hupijiao topup failed: " + err.Error())
		return errors.New("充值失败，请稍后重试")
	}

	if quotaToAdd > 0 {
		RecordTopupLog(topUp.UserId, fmt.Sprintf("支付宝充值 %.2f 元", topUp.Money), "", topUp.PaymentMethod, PaymentMethodHupijiao)
		if inviterId > 0 && inviteRewardQuota > 0 {
			RecordLog(inviterId, LogTypeSystem, fmt.Sprintf("虎皮椒邀请奖励，来自用户 %d，待转移奖励额度: %v，支付金额: %.2f", topUp.UserId, logger.FormatQuota(inviteRewardQuota), amount))
		}
		UpgradeUserGroupOnTopup(topUp.UserId)
	}

	return nil
}
