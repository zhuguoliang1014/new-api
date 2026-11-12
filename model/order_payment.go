package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

// CloseUnpaidOrder updates the subscription and its billing row together. The
// optional replacement preserves an unexpired quote while reserving new stock.
// Closed checkouts cannot be reopened by later payment notifications.
func CloseUnpaidOrder(tradeNo, provider string, replacement *TopUp) error {
	return transitionUnpaidOrder(tradeNo, provider, common.TopUpStatusCanceled, replacement)
}

func ExpireUnpaidOrder(tradeNo, provider string) error {
	return transitionUnpaidOrder(tradeNo, provider, common.TopUpStatusExpired, nil)
}

func transitionUnpaidOrder(tradeNo, provider, status string, replacement *TopUp) error {
	var info SubscriptionOrder
	lookup := DB.Select("plan_id").Where("trade_no = ?", tradeNo).First(&info).Error
	if lookup != nil && !errors.Is(lookup, gorm.ErrRecordNotFound) {
		return lookup
	}
	return DB.Transaction(func(tx *gorm.DB) error {
		if info.PlanId > 0 {
			if _, err := lockSubscriptionSalePlanTx(tx, info.PlanId); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
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
		if replacement != nil && (order.Status != common.TopUpStatusPending || order.CreateTime+SubscriptionPendingOrderTTLSeconds <= common.GetTimestamp()) {
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
			// Replacing a checkout must reserve a fresh place under the plan
			// lock. Closed orders cannot bypass the stock cap on repay.
			plan, err := lockSubscriptionSalePlanTx(tx, subscription.PlanId)
			if err != nil {
				return err
			}
			if !plan.Enabled {
				return common.NewMessage("Subscription plan is not enabled")
			}
			if err := checkSubscriptionSaleCapacityTx(tx, plan); err != nil {
				return err
			}
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

// Keep the closed status and record the receipt before returning an error to
// the gateway. An administrator can reconcile/refund it without giving a
// cancelled purchase any quota, referral reward or subscription entitlement.
func rejectClosedTopUpPaymentTx(tx *gorm.DB, order *TopUp) (bool, error) {
	now := common.GetTimestamp()
	if order.Status == common.TopUpStatusPending && order.CreateTime > now-SubscriptionPendingOrderTTLSeconds {
		return false, nil
	}
	if order.Status != common.TopUpStatusPending && order.Status != common.TopUpStatusExpired && order.Status != common.TopUpStatusCanceled {
		return false, ErrTopUpStatusInvalid
	}
	status := order.Status
	if status == common.TopUpStatusPending {
		status = common.TopUpStatusExpired
	}
	if order.PaymentReceivedAfterClose > 0 {
		return true, nil
	}
	if err := tx.Model(order).Updates(map[string]any{"status": status, "complete_time": now, "payment_received_after_close": now}).Error; err != nil {
		return false, err
	}
	return true, nil
}

// Expire pending wallet orders too; subscription billing rows are closed
// atomically by the subscription pass before this pass runs.
func ExpirePendingTopUpOrders(cutoff int64, limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	var orders []TopUp
	if err := DB.Where("status = ? AND create_time <= ? AND NOT EXISTS (SELECT 1 FROM subscription_orders WHERE subscription_orders.trade_no = top_ups.trade_no)", common.TopUpStatusPending, cutoff).Order("id asc").Limit(limit).Find(&orders).Error; err != nil {
		return 0, err
	}
	changed := 0
	for _, o := range orders {
		updated := false
		err := DB.Transaction(func(tx *gorm.DB) error {
			var locked TopUp
			if err := lockForUpdate(tx).Where("trade_no = ?", o.TradeNo).First(&locked).Error; err != nil {
				return err
			}
			if locked.Status != common.TopUpStatusPending || locked.CreateTime > cutoff {
				return nil
			}
			if err := tx.Model(&locked).Updates(map[string]any{"status": common.TopUpStatusExpired, "complete_time": common.GetTimestamp()}).Error; err != nil {
				return err
			}
			updated = true
			return nil
		})
		if err != nil {
			return changed, err
		}
		if updated {
			changed++
		}
	}
	return changed, nil
}
