package model

import (
	"errors"
	"fmt"
	"math"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// Called by the existing SQLite/MySQL/PostgreSQL lifecycle harness.
func testSubscriptionFreezeCards(t *testing.T, db *gorm.DB) {
	t.Helper()
	now := time.Date(2026, 11, 26, 12, 0, 0, 0, subscriptionHolidayTimezone).Unix()
	user := User{Username: "freeze-cards-user", AffCode: "freeze-cards", Group: "default", FreezeCards: 2}
	require.NoError(t, db.Create(&user).Error)
	plan := SubscriptionPlan{Title: "Card target", DurationUnit: "month", DurationValue: 1, QuotaResetPeriod: "never"}
	require.NoError(t, db.Create(&plan).Error)
	snapshot, err := encodeSubscriptionPlan(&plan)
	require.NoError(t, err)
	sub := UserSubscription{UserId: user.Id, PlanId: plan.Id, PlanSnapshot: snapshot, Status: "active", EndTime: now + 86400, AmountTotal: 1000, AmountUsed: 250}
	require.NoError(t, db.Create(&sub).Error)
	apply := func(id int, frozen, consent bool, at int64, rollback bool) error {
		return db.Transaction(func(tx *gorm.DB) error {
			_, err := setUserSubscriptionFrozenTx(tx, user.Id, id, frozen, func() int64 { return at }, consent)
			if err == nil && rollback {
				return errors.New("forced rollback")
			}
			return err
		})
	}
	check := func(cards, used int, status string) {
		t.Helper()
		var gotUser User
		var gotSub UserSubscription
		require.NoError(t, db.First(&gotUser, user.Id).Error)
		require.NoError(t, db.First(&gotSub, sub.Id).Error)
		require.Equal(t, cards, gotUser.FreezeCards)
		require.Equal(t, used, gotSub.FreezeCardsUsed)
		require.Equal(t, status, gotSub.Status)
		require.EqualValues(t, 250, gotSub.AmountUsed)
	}
	require.ErrorContains(t, apply(sub.Id, true, false, now, false), "确认")
	check(2, 0, "active")
	require.ErrorContains(t, apply(sub.Id, true, true, now, true), "forced rollback")
	check(2, 0, "active")
	require.NoError(t, apply(sub.Id, true, true, now, false))
	check(1, 1, "frozen")
	require.NoError(t, apply(sub.Id, true, true, now+1, false))
	check(1, 1, "frozen")
	require.NoError(t, apply(sub.Id, false, true, now+3600, false))
	check(1, 1, "active")
	var resumed UserSubscription
	require.NoError(t, db.First(&resumed, sub.Id).Error)
	require.Equal(t, sub.EndTime+3600, resumed.EndTime)
	// Holiday wins over an explicit consent flag, including a dialog opened before midnight.
	holiday := time.Date(2026, 10, 1, 12, 0, 0, 0, subscriptionHolidayTimezone).Unix()
	require.NoError(t, apply(sub.Id, true, true, holiday, false))
	check(1, 1, "frozen")
	require.NoError(t, apply(sub.Id, false, false, holiday+1, false))
	// An unrelated active plan can spend the same user's last card.
	other := sub
	other.Id = 0
	other.PlanId = plan.Id + 1000
	require.NoError(t, db.Create(&other).Error)
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, id := range []int{sub.Id, other.Id} {
		go func(id int) { <-start; results <- apply(id, true, true, now+7200, false) }(id)
	}
	close(start)
	successes := 0
	for range 2 {
		if <-results == nil {
			successes++
		}
	}
	require.Equal(t, 1, successes, "the last card can only freeze one subscription")
	var saved User
	require.NoError(t, db.First(&saved, user.Id).Error)
	require.Zero(t, saved.FreezeCards)
	var frozenCount int64
	require.NoError(t, db.Model(&UserSubscription{}).Where("user_id = ? AND status = ?", user.Id, "frozen").Count(&frozenCount).Error)
	require.EqualValues(t, 1, frozenCount)
	var remaining UserSubscription
	require.NoError(t, db.Where("user_id = ? AND status = ?", user.Id, "active").First(&remaining).Error)
	require.ErrorContains(t, apply(remaining.Id, true, true, now+7201, false), "不足")
	// User edits must never overwrite the live card balance from a stale profile.
	user.DisplayName = "edited"
	require.NoError(t, user.UpdateWithTx(db, false))
	require.Zero(t, user.FreezeCards)
	// Admin creation uses the same configured bonus on every supported database.
	require.NoError(t, db.Model(&plan).UpdateColumn("freeze_cards", 3).Error)
	_, err = AdminBindSubscription(user.Id, plan.Id, "admin bonus regression")
	require.NoError(t, err)
	require.NoError(t, db.First(&user, user.Id).Error)
	require.Equal(t, 3, user.FreezeCards)
	var granted UserSubscription
	require.NoError(t, db.Where("user_id = ? AND source = ?", user.Id, "admin").First(&granted).Error)
	require.Equal(t, 3, granted.FreezeCardsGranted)
	require.NoError(t, db.Model(&plan).UpdateColumn("freeze_cards", 0).Error)
	_, err = AdminBindSubscription(user.Id, plan.Id, "no bonus configured")
	require.NoError(t, err)
	require.NoError(t, db.First(&user, user.Id).Error)
	require.Equal(t, 3, user.FreezeCards)
}

func TestFreezeCardPurchaseBonuses(t *testing.T) {
	for _, source := range []string{"hupijiao", "order", PaymentMethodBalance, "admin"} {
		t.Run(source, func(t *testing.T) {
			truncateTables(t)
			user := User{Username: "card-buyer-" + source, AffCode: "card-buyer-" + source, Quota: 10000000}
			require.NoError(t, DB.Create(&user).Error)
			plan := SubscriptionPlan{Title: "Bonus", Enabled: true, FreezeCards: 3, PriceAmount: 1, PriceCNY: 1, DurationUnit: "month", DurationValue: 1}
			require.NoError(t, DB.Create(&plan).Error)
			var err error
			switch source {
			case "order", "hupijiao":
				provider := PaymentProviderEpay
				if source == "hupijiao" {
					provider = SubscriptionPaymentProviderHupijiao
				}
				order := SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, TradeNo: "cards-" + source, Money: 1, PaymentProvider: provider, Status: common.TopUpStatusPending}
				require.NoError(t, order.Insert())
				require.NoError(t, DB.Model(&plan).Update("freeze_cards", 9).Error)
				// Deleting the catalog item must still deliver the purchased bonus, once.
				require.NoError(t, DB.Delete(&plan).Error)
				for range 2 {
					if source == "hupijiao" {
						err = CompleteHupijiaoSubscriptionOrder(order.TradeNo, 1, "verified")
					} else {
						err = CompleteSubscriptionOrder(order.TradeNo, "verified", provider, "")
					}
					require.NoError(t, err)
				}
			case PaymentMethodBalance:
				err = PurchaseSubscriptionWithBalance(user.Id, plan.Id)
			default:
				_, err = AdminBindSubscription(user.Id, plan.Id, "test")
			}
			require.NoError(t, err)
			var saved User
			require.NoError(t, DB.First(&saved, user.Id).Error)
			expected := 3
			require.Equal(t, expected, saved.FreezeCards)
			var subs []UserSubscription
			require.NoError(t, DB.Where("user_id = ?", user.Id).Find(&subs).Error)
			require.Len(t, subs, 1)
			require.Equal(t, expected, subs[0].FreezeCardsGranted)
		})
	}
}

func TestFreezeCardGrantRollbackAndBounds(t *testing.T) {
	truncateTables(t)
	user := User{Username: "card-rollback", AffCode: "card-rollback", FreezeCards: math.MaxInt32 - 1}
	require.NoError(t, DB.Create(&user).Error)
	plan := SubscriptionPlan{Title: "Bonus", FreezeCards: 2, DurationUnit: "month", DurationValue: 1}
	require.NoError(t, DB.Create(&plan).Error)
	err := DB.Transaction(func(tx *gorm.DB) error {
		_, err := CreateUserSubscriptionFromPlanTx(tx, user.Id, &plan, "order")
		return err
	})
	require.Error(t, err)
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", user.Id).Count(&count).Error)
	require.Zero(t, count)
	require.NoError(t, DB.Model(&user).UpdateColumn("freeze_cards", 0).Error)
	err = DB.Transaction(func(tx *gorm.DB) error {
		_, err := CreateUserSubscriptionFromPlanTx(tx, user.Id, &plan, "order")
		if err != nil {
			return err
		}
		return fmt.Errorf("payment failed after grant")
	})
	require.Error(t, err)
	require.NoError(t, DB.First(&user, user.Id).Error)
	require.Zero(t, user.FreezeCards)
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", user.Id).Count(&count).Error)
	require.Zero(t, count)
	for _, n := range []int{-1, 1000001} {
		plan.FreezeCards = n
		require.Error(t, plan.ValidateFreezeCards())
	}
}

func TestClosedSubscriptionPaymentDoesNotGrantFreezeCards(t *testing.T) {
	for _, status := range []string{common.TopUpStatusCanceled, common.TopUpStatusExpired} {
		t.Run(status, func(t *testing.T) {
			truncateTables(t)
			user := User{Username: "cards-closed", AffCode: "cards-closed"}
			require.NoError(t, DB.Create(&user).Error)
			plan := SubscriptionPlan{Title: "Closed bonus", Enabled: true, FreezeCards: 3, PriceCNY: 1, PriceAmount: 1, DurationUnit: "month", DurationValue: 1}
			require.NoError(t, DB.Create(&plan).Error)
			order := SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, TradeNo: "cards-closed-" + status, Money: 1, Status: common.TopUpStatusPending, PaymentProvider: SubscriptionPaymentProviderHupijiao}
			require.NoError(t, order.Insert())
			require.NoError(t, DB.Model(&order).UpdateColumn("status", status).Error)
			require.ErrorIs(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 1, "late payment"), ErrSubscriptionPaymentClosed)
			require.NoError(t, DB.First(&user, user.Id).Error)
			require.Zero(t, user.FreezeCards)
		})
	}
}

func TestBalanceTopUpAndUnconfiguredSubscriptionDoNotGrantFreezeCards(t *testing.T) {
	for _, kind := range []string{"balance topup", "subscription without bonus", "admin without bonus"} {
		t.Run(kind, func(t *testing.T) {
			truncateTables(t)
			user := User{Username: "no-card-bonus", AffCode: "no-card-bonus", FreezeCards: 2}
			require.NoError(t, DB.Create(&user).Error)
			if kind == "balance topup" {
				topup := TopUp{UserId: user.Id, Amount: 100, Money: 1, TradeNo: "topup-no-cards", PaymentProvider: PaymentProviderHupijiao, PaymentMethod: PaymentMethodAlipay, Status: common.TopUpStatusPending, CreateTime: common.GetTimestamp()}
				require.NoError(t, topup.Insert())
				for range 2 {
					require.NoError(t, RechargeByHupijiao(topup.TradeNo, 1))
				}
			} else {
				plan := SubscriptionPlan{Title: "No bonus configured", Enabled: true, PriceAmount: 1, PriceCNY: 1, DurationUnit: "month", DurationValue: 1}
				require.NoError(t, DB.Create(&plan).Error)
				order := SubscriptionOrder{UserId: user.Id, PlanId: plan.Id, TradeNo: "subscription-no-cards", Money: 1, PaymentProvider: SubscriptionPaymentProviderHupijiao, Status: common.TopUpStatusPending}
				if kind == "admin without bonus" {
					_, err := AdminBindSubscription(user.Id, plan.Id, "test")
					require.NoError(t, err)
				} else {
					require.NoError(t, order.Insert())
					require.NoError(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 1, "verified"))
				}
				var sub UserSubscription
				require.NoError(t, DB.Where("user_id = ?", user.Id).First(&sub).Error)
				require.Zero(t, sub.FreezeCardsGranted)
			}
			require.NoError(t, DB.First(&user, user.Id).Error)
			require.Equal(t, 2, user.FreezeCards)
		})
	}
}
