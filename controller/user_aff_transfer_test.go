package controller

import (
	"errors"
	"testing"

	"github.com/QuantumNous/new-api/common"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseTransferAffQuotaRequestAcceptsQuota(t *testing.T) {
	quota := 3250000
	got, err := parseTransferAffQuotaRequest(TransferAffQuotaRequest{
		Quota: &quota,
	})

	require.NoError(t, err)
	assert.Equal(t, quota, got)
}

func TestParseTransferAffQuotaRequestAcceptsLegacyUSDAmount(t *testing.T) {
	original := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		common.QuotaPerUnit = original
	})

	amount := 6.5
	got, err := parseTransferAffQuotaRequest(TransferAffQuotaRequest{
		Amount: &amount,
	})

	require.NoError(t, err)
	assert.Equal(t, 3250000, got)
}

func TestParseTransferAffQuotaRequestRejectsBelowOneCent(t *testing.T) {
	original := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() {
		common.QuotaPerUnit = original
	})

	amount := 0.009
	_, err := parseTransferAffQuotaRequest(TransferAffQuotaRequest{
		Amount: &amount,
	})

	require.Error(t, err)
	assert.True(t, errors.Is(err, errTransferAmountMinimum))
}
