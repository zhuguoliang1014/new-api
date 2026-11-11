package model

import (
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
	// Epay and Hupijiao accept authenticated late payments after a local timeout.
	// Those checkouts must keep their place until payment is settled. A browser
	// countdown or an unpaid status query is not proof that payment is impossible.
	return tx.Model(&SubscriptionOrder{}).Where(
		"status IN ? OR (payment_provider IN ? AND status IN ?)",
		[]string{common.TopUpStatusSuccess, common.TopUpStatusPending},
		[]string{PaymentProviderEpay, SubscriptionPaymentProviderHupijiao},
		[]string{common.TopUpStatusExpired, common.TopUpStatusCanceled},
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
