package model

import (
	"math"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHupijiaoPaymentsDoNotRewardInviter(t *testing.T) {
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 1
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })

	for _, name := range []string{"topup", "subscription", "manual"} {
		t.Run(name, func(t *testing.T) {
			truncateTables(t)
			inviter := &User{Id: 2101, Username: "hupi_inviter", Status: common.UserStatusEnabled, Quota: 10, AffQuota: 25, AffHistoryQuota: 50, AffCode: "hupi_inviter"}
			invitee := &User{Id: 2102, Username: "hupi_invitee", Status: common.UserStatusEnabled, InviterId: inviter.Id, AffCode: "hupi_invitee"}
			require.NoError(t, DB.Create(inviter).Error)
			require.NoError(t, DB.Create(invitee).Error)
			tradeNo := "hupijiao-no-reward-" + name
			if name == "subscription" {
				plan := &SubscriptionPlan{Title: "Hupijiao Plan", PriceAmount: 20, PriceCNY: 100, Currency: "USD", DurationUnit: SubscriptionDurationMonth, DurationValue: 1, Enabled: true, TotalAmount: 1000}
				require.NoError(t, DB.Create(plan).Error)
				order := &SubscriptionOrder{UserId: invitee.Id, PlanId: plan.Id, Money: 100, TradeNo: tradeNo, PaymentMethod: SubscriptionPaymentMethodAlipay, PaymentProvider: SubscriptionPaymentProviderHupijiao, CreateTime: time.Now().Unix(), Status: common.TopUpStatusPending}
				require.NoError(t, order.Insert())
				require.NoError(t, CompleteHupijiaoSubscriptionOrder(tradeNo, 100, "{}"))
				require.NoError(t, CompleteHupijiaoSubscriptionOrder(tradeNo, 100, "{}"))
				var count int64
				require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", invitee.Id).Count(&count).Error)
				assert.Equal(t, int64(1), count)
			} else {
				topup := &TopUp{UserId: invitee.Id, Amount: 50000, Money: 100, TradeNo: tradeNo, PaymentMethod: PaymentMethodAlipay, PaymentProvider: PaymentProviderHupijiao, CreateTime: time.Now().Unix(), Status: common.TopUpStatusPending}
				require.NoError(t, topup.Insert())
				if name == "manual" {
					require.NoError(t, ManualCompleteTopUp(tradeNo, "127.0.0.1"))
					require.NoError(t, ManualCompleteTopUp(tradeNo, "127.0.0.1"))
				} else {
					require.NoError(t, RechargeByHupijiao(tradeNo, 100))
					require.NoError(t, RechargeByHupijiao(tradeNo, 100))
				}
				var creditedUser User
				require.NoError(t, DB.First(&creditedUser, invitee.Id).Error)
				assert.Equal(t, 500, creditedUser.Quota)
				var logCount int64
				require.NoError(t, LOG_DB.Model(&Log{}).Where("user_id = ? AND type = ?", invitee.Id, LogTypeTopup).Count(&logCount).Error)
				assert.Equal(t, int64(1), logCount)
			}
			var unchangedInviter User
			require.NoError(t, DB.First(&unchangedInviter, inviter.Id).Error)
			assert.Equal(t, 10, unchangedInviter.Quota)
			assert.Equal(t, 25, unchangedInviter.AffQuota)
			assert.Equal(t, 50, unchangedInviter.AffHistoryQuota)
			var topup TopUp
			require.NoError(t, DB.Where("trade_no = ?", tradeNo).First(&topup).Error)
			assert.Equal(t, common.TopUpStatusSuccess, topup.Status)
		})
	}
}

func TestRechargeByHupijiaoRejectsInvalidPaymentsAndWalletOverflow(t *testing.T) {
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 1
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })

	for _, tc := range []struct {
		name   string
		amount int64
		paid   float64
		wallet int
	}{
		{name: "wallet ceiling", amount: 100, paid: 1, wallet: common.MaxWalletQuota},
		{name: "stored amount overflow", amount: math.MaxInt64, paid: 1},
		{name: "nan payment", amount: 100, paid: math.NaN()},
		{name: "infinite payment", amount: 100, paid: math.Inf(1)},
		{name: "underpayment", amount: 100, paid: 0.5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			truncateTables(t)
			user := &User{Id: 2301, Username: "hupi_invalid_payment", Status: common.UserStatusEnabled, Quota: tc.wallet, AffCode: "hupi_invalid"}
			require.NoError(t, DB.Create(user).Error)
			topup := &TopUp{UserId: user.Id, Amount: tc.amount, Money: 1, TradeNo: "hupijiao-invalid", PaymentMethod: PaymentMethodAlipay, PaymentProvider: PaymentProviderHupijiao, Status: common.TopUpStatusPending}
			require.NoError(t, topup.Insert())
			require.Error(t, RechargeByHupijiao(topup.TradeNo, tc.paid))
			require.NoError(t, DB.First(&user, user.Id).Error)
			assert.Equal(t, tc.wallet, user.Quota)
			require.NoError(t, DB.First(&topup, topup.Id).Error)
			assert.Equal(t, common.TopUpStatusPending, topup.Status)
		})
	}
}

func TestHupijiaoOrderIDUpdatePreservesCompletedPayment(t *testing.T) {
	truncateTables(t)
	originalQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 1
	t.Cleanup(func() { common.QuotaPerUnit = originalQuotaPerUnit })
	user := &User{Id: 2501, Username: "hupi_order_id_update", Status: common.UserStatusEnabled, Quota: 10, AffCode: "hupi_order_id"}
	require.NoError(t, DB.Create(user).Error)
	staleOrder := &TopUp{UserId: user.Id, Amount: 100, Money: 1, TradeNo: "hupijiao-order-id-update", PaymentMethod: PaymentMethodAlipay, PaymentProvider: PaymentProviderHupijiao, Status: common.TopUpStatusPending}
	require.NoError(t, staleOrder.Insert())

	// A webhook can finish while checkout creation is waiting for the provider.
	require.NoError(t, RechargeByHupijiao(staleOrder.TradeNo, 1))
	staleOrder.OpenOrderId = "new-provider-order"
	require.NoError(t, staleOrder.UpdateOpenOrderID())
	require.NoError(t, RechargeByHupijiao(staleOrder.TradeNo, 1))

	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, 11, user.Quota)
	var saved TopUp
	require.NoError(t, DB.First(&saved, staleOrder.Id).Error)
	assert.Equal(t, common.TopUpStatusSuccess, saved.Status)
	assert.Positive(t, saved.CompleteTime)
	assert.Equal(t, "new-provider-order", saved.OpenOrderId)
	var logCount int64
	require.NoError(t, LOG_DB.Model(&Log{}).Where("user_id = ? AND type = ?", user.Id, LogTypeTopup).Count(&logCount).Error)
	assert.EqualValues(t, 1, logCount)
}

func TestTransferAffQuotaPreservesBalancesAtWalletCeiling(t *testing.T) {
	truncateTables(t)
	user := &User{Id: 2401, Username: "hupi_transfer_ceiling", Status: common.UserStatusEnabled, Quota: common.MaxWalletQuota, AffQuota: 500000, AffCode: "hupi_transfer"}
	require.NoError(t, DB.Create(user).Error)
	require.ErrorIs(t, user.TransferAffQuotaToQuota(500000), ErrWalletQuotaLimitExceeded)
	require.NoError(t, DB.First(&user, user.Id).Error)
	assert.Equal(t, common.MaxWalletQuota, user.Quota)
	assert.Equal(t, 500000, user.AffQuota)
}
