package model

import (
	"math"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

// creditPaidTopUp settles wallet quota and its referral reward together.
func creditPaidTopUp(tx *gorm.DB, topUp *TopUp, creditedQuota int, updates map[string]any) error {
	if err := creditTopUpQuota(tx, topUp.UserId, creditedQuota, updates); err != nil {
		return err
	}
	return creditPaymentReferralTx(tx, topUp)
}

// creditPaymentReferralTx rewards an external CNY payment in the existing
// locked-order transaction. Subscription payments use their mirrored TopUp
// solely as the receipt; they must not credit wallet quota. Balance purchases
// and redemption codes are excluded to avoid rewarding the same money twice.
func creditPaymentReferralTx(tx *gorm.DB, topUp *TopUp) error {
	if topUp.ReferralQuota > 0 {
		return nil
	}
	percent := operation_setting.GetReferralRewardPercent()
	if percent <= 0 || !operation_setting.IsPaymentComplianceConfirmed() ||
		inferPaymentCurrency(topUp.PaymentMethod, topUp.PaymentProvider) != "CNY" ||
		math.IsNaN(topUp.Money) || math.IsInf(topUp.Money, 0) || topUp.Money <= 0 ||
		math.IsNaN(common.QuotaPerUnit) || math.IsInf(common.QuotaPerUnit, 0) || common.QuotaPerUnit <= 0 {
		return nil
	}
	// Product policy: CNY 1 of referral reward is USD 1 of wallet quota.
	// Base it on actual payment, so discounts and promotional quota do not
	// inflate the reward. Truncate to the smallest quota unit.
	reward, err := common.WalletQuotaFromDecimalStrict(decimal.NewFromFloat(topUp.Money).
		Mul(decimal.NewFromFloat(percent)).Div(decimal.NewFromInt(100)).
		Mul(decimal.NewFromFloat(common.QuotaPerUnit)).Truncate(0))
	if err != nil || reward <= 0 {
		return nil
	}
	var buyer User
	if err := tx.Select("id", "inviter_id", "status").First(&buyer, topUp.UserId).Error; err != nil {
		return err
	}
	if buyer.Status != common.UserStatusEnabled || buyer.InviterId <= 0 || buyer.InviterId == buyer.Id {
		return nil
	}
	result := tx.Model(&User{}).
		Where("id = ? AND status = ? AND aff_quota <= ? AND aff_history <= ?", buyer.InviterId, common.UserStatusEnabled, common.MaxWalletQuota-reward, common.MaxWalletQuota-reward).
		Updates(map[string]any{"aff_quota": gorm.Expr("aff_quota + ?", reward), "aff_history": gorm.Expr("aff_history + ?", reward)})
	if result.Error != nil {
		return result.Error
	}
	// An unavailable or capped inviter must not prevent the payer's recharge.
	if result.RowsAffected == 0 {
		return nil
	}
	return tx.Model(topUp).Updates(map[string]any{
		"referral_user_id": buyer.InviterId, "referral_quota": reward, "referral_percent": percent,
	}).Error
}
