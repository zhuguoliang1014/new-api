package openai

import (
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	hosttypes "github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type realtimeBillingReservation struct {
	relaycommon.BillingSettler
	targets []int
}

func (b *realtimeBillingReservation) Reserve(quota int) error {
	b.targets = append(b.targets, quota)
	return nil
}

func TestRealtimeResponsesReserveCumulativeQuotaAndReportIndividualCost(t *testing.T) {
	billing := &realtimeBillingReservation{}
	info := &relaycommon.RelayInfo{Billing: billing, OriginModelName: "gpt-4o-realtime-preview", PriceData: hosttypes.PriceData{ModelRatio: 1, GroupRatioInfo: hosttypes.GroupRatioInfo{GroupRatio: 1}}}
	totalUsage := &dto.RealtimeUsage{}
	totalQuota := 0
	for _, tokens := range []int{10, 20} {
		usage := &dto.RealtimeUsage{TotalTokens: tokens, InputTokens: tokens}
		usage.InputTokenDetails.TextTokens = tokens
		quota, err := preConsumeUsage(&gin.Context{}, info, usage, totalUsage, &totalQuota)
		require.NoError(t, err)
		assert.Equal(t, tokens, quota, "plugin events must contain only this response's cost")
	}
	assert.Equal(t, []int{10, 30}, billing.targets, "the subscription reservation must cover the whole session")
	assert.Equal(t, 30, totalUsage.InputTokens)
}
