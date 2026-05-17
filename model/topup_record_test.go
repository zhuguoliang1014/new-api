package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
)

func TestBuildTopUpRecordsNormalizesStoredAmounts(t *testing.T) {
	originalQuotaPerUnit := common.QuotaPerUnit
	t.Cleanup(func() {
		common.QuotaPerUnit = originalQuotaPerUnit
	})
	common.QuotaPerUnit = 500000

	records := BuildTopUpRecords([]*TopUp{
		{
			Amount:          50,
			PaymentProvider: PaymentProviderEpay,
			TradeNo:         "epay-usd",
		},
		{
			Amount:          5000,
			PaymentProvider: PaymentProviderHupijiao,
			TradeNo:         "hupijiao-usd-cents",
		},
		{
			Amount:          25000000,
			PaymentProvider: PaymentProviderCreem,
			TradeNo:         "creem-quota",
		},
	})

	assert.Len(t, records, 3)
	assert.Equal(t, 50.0, records[0].Amount)
	assert.Equal(t, 50.0, records[1].Amount)
	assert.Equal(t, 50.0, records[2].Amount)
}

func TestBuildTopUpRecordsKeepsHupijiaoCentPrecision(t *testing.T) {
	records := BuildTopUpRecords([]*TopUp{
		{
			Amount:          1234,
			PaymentProvider: PaymentProviderHupijiao,
			TradeNo:         "hupijiao-cent-precision",
		},
	})

	assert.Len(t, records, 1)
	assert.Equal(t, 12.34, records[0].Amount)
}
