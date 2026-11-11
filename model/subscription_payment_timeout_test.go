package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestExpiredAndCancelledCheckoutsDoNotHoldSalesPlaces(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	p := SubscriptionPlan{Title: "Twenty places", Enabled: true, SalesLimit: 20}
	require.NoError(t, DB.Create(&p).Error)
	for i := range 6 {
		require.NoError(t, DB.Create(&SubscriptionOrder{PlanId: p.Id, UserId: 1, TradeNo: common.GetRandomString(20), Status: common.TopUpStatusSuccess, CreateTime: now - int64(i)}).Error)
	}
	for _, o := range []SubscriptionOrder{
		{PlanId: p.Id, TradeNo: "cancelled-old", Status: common.TopUpStatusCanceled, CreateTime: now - 86400, PaymentProvider: SubscriptionPaymentProviderHupijiao},
		{PlanId: p.Id, TradeNo: "expired-old", Status: common.TopUpStatusExpired, CreateTime: now - 3600, PaymentProvider: PaymentProviderEpay},
		{PlanId: p.Id, TradeNo: "pending-old", Status: common.TopUpStatusPending, CreateTime: now - 1800, PaymentProvider: SubscriptionPaymentProviderHupijiao},
	} {
		require.NoError(t, DB.Create(&o).Error)
	}
	counts, err := GetSubscriptionSalesCounts([]int{p.Id})
	require.NoError(t, err)
	require.EqualValues(t, 6, counts[p.Id].Sold)
	require.Zero(t, counts[p.Id].Reserved, "30 minutes expires the hold even before the worker runs")
}

func TestThirtyMinuteWorkerExpiresSubscriptionAndMirroredBillingAtomically(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	p := SubscriptionPlan{Title: "one", Enabled: true, SalesLimit: 1}
	require.NoError(t, DB.Create(&p).Error)
	order := SubscriptionOrder{PlanId: p.Id, UserId: 77, TradeNo: "timeout-30", Money: 10, PaymentProvider: SubscriptionPaymentProviderHupijiao, Status: common.TopUpStatusPending, CreateTime: now - 1800}
	require.NoError(t, DB.Create(&order).Error)
	mirror := TopUp{UserId: 77, TradeNo: order.TradeNo, Money: 10, PaymentProvider: order.PaymentProvider, Status: common.TopUpStatusPending, CreateTime: order.CreateTime}
	require.NoError(t, DB.Create(&mirror).Error)
	n, err := ExpirePendingSubscriptionOrders(now-1800, 100)
	require.NoError(t, err)
	require.Equal(t, 1, n)
	require.NoError(t, DB.First(&order, order.Id).Error)
	require.Equal(t, common.TopUpStatusExpired, order.Status)
	require.NoError(t, DB.First(&mirror, mirror.Id).Error)
	require.Equal(t, common.TopUpStatusExpired, mirror.Status)
	require.ErrorIs(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 10, "authenticated receipt"), ErrSubscriptionPaymentClosed)
	require.ErrorIs(t, CompleteHupijiaoSubscriptionOrder(order.TradeNo, 10, "duplicate receipt"), ErrSubscriptionPaymentClosed)
	require.NoError(t, DB.First(&order, order.Id).Error)
	require.Equal(t, common.TopUpStatusExpired, order.Status)
	require.Contains(t, order.ProviderPayload, "closed_order_received_payment")
	require.NoError(t, DB.First(&mirror, mirror.Id).Error)
	require.Positive(t, mirror.PaymentReceivedAfterClose)
	var count int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("plan_id = ?", p.Id).Count(&count).Error)
	require.Zero(t, count)
	n, err = ExpirePendingSubscriptionOrders(now-1800, 100)
	require.NoError(t, err)
	require.Zero(t, n)
}

func TestThirtyMinuteWorkerDoesNotCancelPaidOrFreshWalletOrders(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	for _, o := range []TopUp{
		{TradeNo: "wallet-old", Status: common.TopUpStatusPending, CreateTime: now - 1800},
		{TradeNo: "wallet-new", Status: common.TopUpStatusPending, CreateTime: now - 1799},
		{TradeNo: "wallet-paid", Status: common.TopUpStatusSuccess, CreateTime: now - 3600},
	} {
		require.NoError(t, DB.Create(&o).Error)
	}
	n, err := ExpirePendingTopUpOrders(now-1800, 100)
	require.NoError(t, err)
	require.Equal(t, 1, n)
	require.Equal(t, common.TopUpStatusExpired, GetTopUpByTradeNo("wallet-old").Status)
	require.Equal(t, common.TopUpStatusPending, GetTopUpByTradeNo("wallet-new").Status)
	require.Equal(t, common.TopUpStatusSuccess, GetTopUpByTradeNo("wallet-paid").Status)
}

func TestClosedWalletReceiptDoesNotCreditOrRewardAndIsVisibleInOrders(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	user := User{Username: "closed-payment-buyer", Status: common.UserStatusEnabled, Quota: 123}
	require.NoError(t, DB.Create(&user).Error)
	for _, provider := range []string{PaymentProviderHupijiao, PaymentProviderEpay} {
		order := TopUp{UserId: user.Id, TradeNo: "closed-wallet-" + provider, Amount: 10000, Money: 100, PaymentProvider: provider, PaymentMethod: "alipay", Status: common.TopUpStatusCanceled, CreateTime: now - 3600}
		require.NoError(t, DB.Create(&order).Error)
		for range 2 {
			var err error
			if provider == PaymentProviderHupijiao {
				err = RechargeByHupijiao(order.TradeNo, 100)
			} else {
				_, err = RechargeEpay(order.TradeNo, "alipay", "")
			}
			require.ErrorIs(t, err, ErrSubscriptionPaymentClosed)
		}
		require.NoError(t, DB.First(&order, order.Id).Error)
		require.Equal(t, common.TopUpStatusCanceled, order.Status)
		require.Positive(t, order.PaymentReceivedAfterClose)
		require.Zero(t, order.ReferralQuota)
		records := BuildTopUpRecords([]*TopUp{&order})
		require.Len(t, records, 1)
		require.True(t, records[0].PaymentException)
	}
	require.NoError(t, DB.First(&user, user.Id).Error)
	require.Equal(t, 123, user.Quota)
}
