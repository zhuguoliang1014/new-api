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

const SubscriptionPendingOrderTTLSeconds int64 = 30 * 60

func subscriptionSaleOrders(tx *gorm.DB) *gorm.DB {
	// Only live pending orders reserve a place. At the 30-minute boundary
	// inventory is released even if the periodic worker has not run yet.
	return tx.Model(&SubscriptionOrder{}).Where(
		"status = ? OR (status = ? AND create_time > ?)",
		common.TopUpStatusSuccess, common.TopUpStatusPending,
		common.GetTimestamp()-SubscriptionPendingOrderTTLSeconds,
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
	if !plan.IsLimitedSale() {
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
// the cap. Zero removes the cap only when limited-sale mode is disabled.
func ValidateSubscriptionSalesLimitTx(tx *gorm.DB, planID, limit int, displaySoldCount int64, limitedSale ...bool) error {
	if _, err := lockSubscriptionSalePlanTx(tx, planID); err != nil {
		return err
	}
	if limit == 0 && (len(limitedSale) == 0 || !limitedSale[0]) {
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

// ExpirePendingSubscriptionOrders closes unpaid checkouts and their mirrored
// billing rows under the same plan -> order -> top-up locks as settlement.
func ExpirePendingSubscriptionOrders(expireTimestamp int64, limit int) (int, error) {
	if limit <= 0 {
		return 0, nil
	}
	var candidates []SubscriptionOrder
	if err := DB.Select("trade_no", "plan_id", "payment_provider").Where("status = ? AND create_time <= ?", common.TopUpStatusPending, expireTimestamp).Order("id asc").Limit(limit).Find(&candidates).Error; err != nil {
		return 0, err
	}
	changed := 0
	for _, candidate := range candidates {
		updated := false
		err := DB.Transaction(func(tx *gorm.DB) error {
			if _, err := lockSubscriptionSalePlanTx(tx, candidate.PlanId); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			var order SubscriptionOrder
			if err := lockForUpdate(tx).Where("trade_no = ?", candidate.TradeNo).First(&order).Error; err != nil {
				return err
			}
			if order.PaymentProvider != candidate.PaymentProvider {
				return ErrPaymentMethodMismatch
			}
			if order.Status != common.TopUpStatusPending || order.CreateTime > expireTimestamp {
				return nil
			}
			now := common.GetTimestamp()
			if err := tx.Model(&order).Updates(map[string]any{"status": common.TopUpStatusExpired, "complete_time": now}).Error; err != nil {
				return err
			}
			if err := tx.Model(&TopUp{}).Where("trade_no = ? AND payment_provider = ? AND status = ?", order.TradeNo, order.PaymentProvider, common.TopUpStatusPending).Updates(map[string]any{"status": common.TopUpStatusExpired, "complete_time": now}).Error; err != nil {
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

var ErrSubscriptionPaymentClosed = common.NewMessage("Payment received for a cancelled order. Please contact support for review.")

// A real payment notification cannot reopen a checkout after cancellation.
// Preserve the authenticated receipt for reconciliation; do not grant a
// subscription, credit a wallet or record successful revenue for this order.
func rejectClosedSubscriptionPaymentTx(tx *gorm.DB, order *SubscriptionOrder, amount float64, payload string) (bool, error) {
	now := common.GetTimestamp()
	if order.Status == common.TopUpStatusPending && order.CreateTime > now-SubscriptionPendingOrderTTLSeconds {
		return false, nil
	}
	if order.Status != common.TopUpStatusPending && order.Status != common.TopUpStatusExpired && order.Status != common.TopUpStatusCanceled {
		return false, ErrSubscriptionOrderStatusInvalid
	}
	status := order.Status
	if status == common.TopUpStatusPending {
		status = common.TopUpStatusExpired
	}
	var previous struct {
		PaymentException string `json:"payment_exception"`
	}
	_ = common.UnmarshalJsonStr(order.ProviderPayload, &previous)
	if previous.PaymentException == "closed_order_received_payment" {
		return true, nil
	}
	receipt, err := common.Marshal(map[string]any{"payment_exception": "closed_order_received_payment", "received_at": now, "amount": amount, "status": status, "provider_payload": payload})
	if err != nil {
		return false, err
	}
	if err := tx.Model(order).Updates(map[string]any{"status": status, "provider_payload": string(receipt), "complete_time": now}).Error; err != nil {
		return false, err
	}
	var billing TopUp
	err = lockForUpdate(tx).Where("trade_no = ?", order.TradeNo).First(&billing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		billing = TopUp{UserId: order.UserId, Money: order.Money, TradeNo: order.TradeNo, PaymentMethod: order.PaymentMethod, PaymentProvider: order.PaymentProvider, CreateTime: order.CreateTime, CompleteTime: now, Status: status, PaymentReceivedAfterClose: now}
		if err := tx.Create(&billing).Error; err != nil {
			return false, err
		}
	} else if err != nil {
		return false, err
	} else {
		if billing.UserId != order.UserId || billing.PaymentProvider != order.PaymentProvider {
			return false, ErrPaymentMethodMismatch
		}
		if billing.Status == common.TopUpStatusSuccess {
			return false, ErrTopUpStatusInvalid
		}
		if err := tx.Model(&billing).Updates(map[string]any{"status": status, "complete_time": now, "payment_received_after_close": now}).Error; err != nil {
			return false, err
		}
	}
	return true, nil
}
