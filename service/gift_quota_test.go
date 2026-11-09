package service

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestGiftWalletFundingRefundAndAsyncTask(t *testing.T) {
	truncate(t)
	seedUser(t, 110001, 1000)
	gift, err := model.GrantGiftQuota(110001, 500, "admin", "service-gift")
	require.NoError(t, err)
	funding := &WalletFunding{userId: 110001, requestID: "gift-wallet-preconsume"}
	require.NoError(t, funding.PreConsume(600))
	require.NoError(t, funding.PreConsume(100))
	require.NoError(t, funding.Settle(-200))
	b, err := model.GetWalletBalance(110001)
	require.NoError(t, err)
	require.Equal(t, 1000, b.BalanceQuota)
	require.Zero(t, b.GiftQuota)
	require.NoError(t, model.DB.Model(gift).Update("expires_at", time.Now().Unix()).Error)
	task := &model.Task{UserId: 110001, TaskID: "gift-async-failure", ChannelId: 1, Quota: 500, PrivateData: model.TaskPrivateData{WalletRequestID: "gift-wallet-preconsume", BillingSource: BillingSourceWallet}}
	require.NoError(t, task.Insert())
	require.True(t, RefundTaskQuota(context.Background(), task, "failed task"))
	b, err = model.GetWalletBalance(110001)
	require.NoError(t, err)
	require.Equal(t, 1000, b.BalanceQuota)
	require.Zero(t, b.GiftQuota)
	require.NoError(t, model.DB.First(gift, gift.Id).Error)
	require.Equal(t, 500, gift.Expired)
	require.Zero(t, task.Quota)
}

func TestGiftWalletTrustSupplementAndMidjourneyProvenance(t *testing.T) {
	truncate(t)
	seedUser(t, 110002, 1000)
	_, err := model.GrantGiftQuota(110002, 500, "admin", "service-trust-gift")
	require.NoError(t, err)
	funding := &WalletFunding{userId: 110002, requestID: "gift-trust"}
	require.NoError(t, funding.Settle(700))
	require.NoError(t, funding.Settle(-300))
	b, err := model.GetWalletBalance(110002)
	require.NoError(t, err)
	require.Equal(t, 1000, b.BalanceQuota)
	require.Equal(t, 100, b.GiftQuota)
	relayInfo := &relaycommon.RelayInfo{UserId: 110002, RequestId: "gift-mj", BillingSource: BillingSourceWallet}
	task := &model.Midjourney{UserId: 110002}
	prepared, err := PrepareMidjourneyTaskBilling(relayInfo, task, 100, true)
	require.NoError(t, err)
	require.True(t, prepared)
	require.Equal(t, "gift-mj", task.WalletRequestID)
}

func TestGiftWalletBillingRejectsMissingRelayInfo(t *testing.T) {
	session, err := NewBillingSession(nil, nil, 0)
	require.Nil(t, session)
	require.NotNil(t, err)
}
