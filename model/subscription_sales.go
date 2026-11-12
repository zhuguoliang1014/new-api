package model

import (
	"errors"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var (
	ErrSubscriptionSoldOut          = common.NewMessage("This subscription plan is sold out")
	ErrSubscriptionSalesReserved    = common.NewMessage("All remaining places are reserved by pending payments. Please try again later.")
	ErrSubscriptionSalesLimitTooLow = common.NewMessage("Sales limit cannot be less than paid, reserved and display sales")
)

// SubscriptionSalesCounts records real payment orders. Display sales consume
// additional stock without creating an order; gifts consume no stock, and
// deleting or cancelling a delivered subscription does not replenish it.
type SubscriptionSalesCounts struct {
	Sold     int64
	Reserved int64
}

func subscriptionSaleOrders(tx *gorm.DB) *gorm.DB {
	return tx.Model(&SubscriptionOrder{}).Where(
		"status IN ? OR (payment_provider IN ? AND status = ?)",
		[]string{common.TopUpStatusSuccess, common.TopUpStatusPending},
		[]string{PaymentProviderEpay, SubscriptionPaymentProviderHupijiao},
		common.TopUpStatusCanceled,
	)
}

func GetSubscriptionSalesCounts(planIDs []int) (map[int]SubscriptionSalesCounts, error) {
	counts := make(map[int]SubscriptionSalesCounts, len(planIDs))
	if len(planIDs) == 0 {
		return counts, nil
	}
	var rows []struct {
		PlanId int
		Status string
		Count  int64
	}
	err := subscriptionSaleOrders(DB).Select("plan_id, status, COUNT(*) AS count").
		Where("plan_id IN ?", planIDs).Group("plan_id, status").Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		count := counts[row.PlanId]
		if row.Status == common.TopUpStatusSuccess {
			count.Sold += row.Count
		} else {
			count.Reserved += row.Count
		}
		counts[row.PlanId] = count
	}
	return counts, nil
}

func lockSubscriptionSalePlanTx(tx *gorm.DB, planID int) (*SubscriptionPlan, error) {
	// Acquire the write lock before taking a read snapshot, including on SQLite.
	// The same row serializes purchases and administrator cap changes across
	// processes. Never use the plan cache for an inventory decision.
	if err := tx.Model(&SubscriptionPlan{}).Where("id = ?", planID).
		UpdateColumn("sales_limit", gorm.Expr("sales_limit")).Error; err != nil {
		return nil, err
	}
	var plan SubscriptionPlan
	if err := lockForUpdate(tx).First(&plan, planID).Error; err != nil {
		return nil, err
	}
	plan.NormalizeDefaults()
	return &plan, nil
}

func checkSubscriptionSaleCapacityTx(tx *gorm.DB, plan *SubscriptionPlan) error {
	if plan.SalesLimit <= 0 {
		return nil
	}
	var occupied int64
	if err := subscriptionSaleOrders(tx).Where("plan_id = ?", plan.Id).Count(&occupied).Error; err != nil {
		return err
	}
	available := int64(plan.SalesLimit) - max(0, plan.DisplaySoldCount)
	if occupied < available {
		return nil
	}
	var sold int64
	if err := tx.Model(&SubscriptionOrder{}).Where("plan_id = ? AND status = ?", plan.Id, common.TopUpStatusSuccess).Count(&sold).Error; err != nil {
		return err
	}
	if sold >= available {
		return ErrSubscriptionSoldOut
	}
	return ErrSubscriptionSalesReserved
}

// ValidateSubscriptionSalesLimitTx locks the plan until its new cap is saved.
// Paid orders, pending reservations and the proposed display sales all consume
// the cap. Setting zero removes the cap.
func ValidateSubscriptionSalesLimitTx(tx *gorm.DB, planID, limit int, displaySoldCount int64) error {
	if _, err := lockSubscriptionSalePlanTx(tx, planID); err != nil {
		return err
	}
	if limit == 0 {
		return nil
	}
	var occupied int64
	if err := subscriptionSaleOrders(tx).Where("plan_id = ?", planID).Count(&occupied).Error; err != nil {
		return err
	}
	if occupied > int64(limit)-displaySoldCount {
		return ErrSubscriptionSalesLimitTooLow
	}
	return nil
}

const SubscriptionPendingOrderTTLSeconds int64 = 5 * 60

// ExpirePendingSubscriptionOrders closes old unpaid orders and their mirrored
// top-up rows. Each transition takes the plan lock before the order lock, the
// same order used by payment completion and stock reservation.
func ExpirePendingSubscriptionOrders(expireTimestamp int64, limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	var candidates []SubscriptionOrder
	if err := DB.Select("trade_no", "payment_provider").
		Where("status = ? AND create_time < ?", common.TopUpStatusPending, expireTimestamp).
		Order("create_time ASC").Limit(limit).Find(&candidates).Error; err != nil {
		return 0, err
	}

	expired := 0
	for _, candidate := range candidates {
		changed, err := expirePendingSubscriptionOrder(candidate.TradeNo, candidate.PaymentProvider, expireTimestamp)
		if err != nil {
			return expired, err
		}
		if changed {
			expired++
		}
	}
	return expired, nil
}

func expirePendingSubscriptionOrder(tradeNo, expectedPaymentProvider string, expireTimestamp int64) (bool, error) {
	var orderInfo SubscriptionOrder
	if err := DB.Select("plan_id").Where("trade_no = ?", tradeNo).First(&orderInfo).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	changed := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		if _, err := lockSubscriptionSalePlanTx(tx, orderInfo.PlanId); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		var order SubscriptionOrder
		if err := lockForUpdate(tx).Where("trade_no = ?", tradeNo).First(&order).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if order.PaymentProvider != expectedPaymentProvider {
			return ErrPaymentMethodMismatch
		}
		if order.Status != common.TopUpStatusPending || order.CreateTime >= expireTimestamp {
			return nil
		}
		now := common.GetTimestamp()
		if err := tx.Model(&order).Updates(map[string]any{
			"status":        common.TopUpStatusExpired,
			"complete_time": now,
		}).Error; err != nil {
			return err
		}
		if err := tx.Model(&TopUp{}).
			Where("trade_no = ? AND payment_provider = ? AND status = ?", tradeNo, expectedPaymentProvider, common.TopUpStatusPending).
			Updates(map[string]any{"status": common.TopUpStatusExpired, "complete_time": now}).Error; err != nil {
			return err
		}
		changed = true
		return nil
	})
	return changed, err
}
