package model

import (
	"context"

	"github.com/QuantumNous/new-api/common"
)

// UnsettledEpayOrder covers both native wallet and subscription checkouts.
// Subscription orders do not have a top_ups row until settlement.
type UnsettledEpayOrder struct {
	Id      int
	TradeNo string
	Money   float64
	UserId  int
}

func ListUnsettledEpayOrders(ctx context.Context, subscription bool, minTime, maxTime int64, afterID, limit int) ([]UnsettledEpayOrder, error) {
	var orders []UnsettledEpayOrder
	query := DB.WithContext(ctx).Model(&TopUp{})
	if subscription {
		query = DB.WithContext(ctx).Model(&SubscriptionOrder{})
	}
	err := query.Where("trade_no NOT IN (?)", DB.Model(&TopUp{}).Select("trade_no").Where("payment_received_after_close > 0")).Select("id", "trade_no", "money", "user_id").
		Where("payment_provider = ? AND status IN ?", PaymentProviderEpay, []string{common.TopUpStatusPending, common.TopUpStatusExpired, common.TopUpStatusCanceled}).
		Where("create_time >= ? AND create_time < ? AND id > ?", minTime, maxTime, afterID).
		Order("id ASC").Limit(min(max(limit, 1), 100)).Find(&orders).Error
	return orders, err
}
