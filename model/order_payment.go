package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// CloseUnpaidOrder updates the subscription and its billing row together. The
// optional replacement preserves the original quote and provider reference so
// an old checkout can still be reconciled if a payment arrives late.
func CloseUnpaidOrder(tradeNo, provider string, replacement *TopUp) error {
	return transitionUnpaidOrder(tradeNo, provider, common.TopUpStatusCanceled, replacement)
}

func ExpireUnpaidOrder(tradeNo, provider string) error {
	return transitionUnpaidOrder(tradeNo, provider, common.TopUpStatusExpired, nil)
}

func transitionUnpaidOrder(tradeNo, provider, status string, replacement *TopUp) error {
	return DB.Transaction(func(tx *gorm.DB) error {
		var subscription SubscriptionOrder
		err := lockForUpdate(tx).Where("trade_no = ?", tradeNo).First(&subscription).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		hasSubscription := err == nil
		if hasSubscription && (subscription.PaymentProvider != provider || subscription.Status == common.TopUpStatusSuccess) {
			return ErrTopUpStatusInvalid
		}
		var order TopUp
		if err := lockForUpdate(tx).Where("trade_no = ?", tradeNo).First(&order).Error; err != nil {
			return err
		}
		if order.PaymentProvider != provider {
			return ErrPaymentMethodMismatch
		}
		if hasSubscription && subscription.UserId != order.UserId {
			return ErrTopUpStatusInvalid
		}
		if status == common.TopUpStatusExpired && order.Status != common.TopUpStatusPending {
			return ErrTopUpStatusInvalid
		}
		if order.Status != common.TopUpStatusPending && order.Status != common.TopUpStatusExpired && order.Status != common.TopUpStatusCanceled {
			return ErrTopUpStatusInvalid
		}
		if replacement != nil && order.Status == common.TopUpStatusCanceled {
			return ErrTopUpStatusInvalid
		}
		now := common.GetTimestamp()
		if err := tx.Model(&order).Updates(map[string]any{"status": status, "complete_time": now}).Error; err != nil {
			return err
		}
		if hasSubscription {
			if err := tx.Model(&subscription).Updates(map[string]any{"status": status, "complete_time": now}).Error; err != nil {
				return err
			}
		}
		if replacement == nil {
			return nil
		}
		if err := tx.Create(replacement).Error; err != nil {
			return err
		}
		if hasSubscription {
			subscription.Id = 0
			subscription.TradeNo = replacement.TradeNo
			subscription.CreateTime = replacement.CreateTime
			subscription.CompleteTime = 0
			subscription.Status = common.TopUpStatusPending
			subscription.PaymentProvider = replacement.PaymentProvider
			subscription.PaymentMethod = replacement.PaymentMethod
			subscription.ProviderPayload = ""
			return tx.Create(&subscription).Error
		}
		return nil
	})
}
