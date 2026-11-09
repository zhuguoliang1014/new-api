package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

var (
	ErrInvalidUserQuotaAdjustment = errors.New("invalid user quota adjustment")
	ErrUserQuotaPermission        = errors.New("cannot adjust quota for this user role")
)

// UserQuotaAdjustment is the immutable database snapshot of a committed manual
// adjustment. Pending relay deductions in the quota cache are not part of it.
type UserQuotaAdjustment struct {
	UserID   int
	Username string
	Before   int
	After    int
}

func AdjustUserQuota(userID, operatorRole int, mode string, value int, quotaTypes ...string) (*UserQuotaAdjustment, error) {
	if userID <= 0 || (mode != "add" && mode != "subtract" && mode != "override") {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if mode != "override" && value <= 0 {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if value > common.MaxWalletQuota || value < -common.MaxWalletQuota {
		return nil, ErrWalletQuotaLimitExceeded
	}

	quotaType := "balance"
	if len(quotaTypes) > 0 && quotaTypes[0] != "" {
		quotaType = quotaTypes[0]
	}
	if quotaType != "balance" && quotaType != "gift" {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	if quotaType == "gift" && mode != "add" {
		return nil, ErrInvalidUserQuotaAdjustment
	}
	var adjustment UserQuotaAdjustment
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).First(&user, userID).Error; err != nil {
			return err
		}
		if operatorRole != common.RoleRootUser && operatorRole <= user.Role {
			return ErrUserQuotaPermission
		}
		now := common.GetTimestamp()
		if err := expireGiftQuotaTx(tx, &user, now); err != nil {
			return err
		}
		balance, err := giftBalanceTx(tx, &user, now)
		if err != nil {
			return err
		}
		if quotaType == "gift" {
			_, err := GrantGiftQuotaTx(tx, userID, value, "admin", "admin:"+common.NewRequestId(), now)
			adjustment = UserQuotaAdjustment{UserID: user.Id, Username: user.Username, Before: balance.GiftQuota, After: balance.GiftQuota + value}
			return err
		}
		user.Quota = balance.BalanceQuota
		if user.Quota > common.MaxWalletQuota || user.Quota < -common.MaxWalletQuota {
			return ErrWalletQuotaLimitExceeded
		}
		quota := decimal.NewFromInt(int64(value))
		switch mode {
		case "add":
			quota = decimal.NewFromInt(int64(user.Quota)).Add(quota)
		case "subtract":
			quota = decimal.NewFromInt(int64(user.Quota)).Sub(quota)
		}
		after, err := common.WalletQuotaFromDecimalStrict(quota)
		if err != nil {
			return ErrWalletQuotaLimitExceeded
		}
		// An unchanged override is a successful operation, including on MySQL
		// configurations that count only changed rows in RowsAffected.
		if after+balance.GiftQuota > common.MaxWalletQuota {
			return ErrWalletQuotaLimitExceeded
		}
		if after != user.Quota {
			result := tx.Model(&User{}).Where("id = ?", userID).Update("quota", after+balance.GiftQuota)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				return gorm.ErrRecordNotFound
			}
		}
		adjustment = UserQuotaAdjustment{UserID: user.Id, Username: user.Username, Before: user.Quota, After: after}
		return nil
	})
	if err != nil {
		return nil, err
	}

	if quotaType == "gift" {
		_ = invalidateUserCache(userID)
	} else {
		if err := cacheIncrUserQuota(userID, int64(adjustment.After)-int64(adjustment.Before)); err != nil {
			common.SysError(common.LogText("failed to sync manual quota adjustment for user %d: %s", userID, err))
		}
	}
	return &adjustment, nil
}
