package relay

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesHTTPWebSocketHistoryOwnershipAndEviction(t *testing.T) {
	before := responsesWSHTTPMemory.Load()
	h := &responsesWSHTTPState{}
	defer func() { h.clear(); assert.Equal(t, before, responsesWSHTTPMemory.Load()) }()
	for i := range responsesWSHTTPHistorySlots + 1 {
		id := fmt.Sprintf("resp_%d", i)
		require.True(t, h.remember(id, fmt.Sprintf("lane_%d", i), "gpt-4o", []common.RawMessage{common.RawMessage(`{"type":"message","role":"user","content":"private"}`)}))
	}
	create, _, err := normalizeResponsesWSTestMessage([]byte(`{"type":"response.create","model":"gpt-4o","previous_response_id":"resp_0","input":"next"}`))
	require.NoError(t, err)
	_, _, apiErr := h.expand(create)
	require.NotNil(t, apiErr)
	assert.Equal(t, "previous_response_not_found", apiErr.ToOpenAIError().Code)
	other := &responsesWSHTTPState{}
	create, _, err = normalizeResponsesWSTestMessage([]byte(`{"type":"response.create","model":"gpt-4o","previous_response_id":"resp_1","input":"next"}`))
	require.NoError(t, err)
	_, _, apiErr = other.expand(create)
	require.NotNil(t, apiErr)
	full, items, apiErr := h.expand(create)
	require.Nil(t, apiErr)
	assert.Empty(t, full.Request.PreviousResponseID)
	assert.Len(t, items, 2)
	// Resetting the same lane replaces only that lane, without destroying another
	// conversation's parent. A missing parent is never forwarded to the provider.
	require.True(t, h.remember("new_1", "lane_1", "gpt-4o", []common.RawMessage{common.RawMessage(`{"role":"user","content":"replacement"}`)}))
	_, _, apiErr = h.expand(create)
	require.NotNil(t, apiErr)
}

func TestResponsesHTTPWebSocketHistoryMemoryBounds(t *testing.T) {
	before := responsesWSHTTPMemory.Load()
	h := &responsesWSHTTPState{}
	defer func() { h.clear(); assert.Equal(t, before, responsesWSHTTPMemory.Load()) }()
	over := common.RawMessage(strings.Repeat("x", responsesWSHTTPContextBytes+1))
	assert.False(t, h.remember("oversize", "main", "gpt-4o", []common.RawMessage{over}))
	assert.Equal(t, before, responsesWSHTTPMemory.Load())
	// A full global budget must reject cache growth without allocating another
	// full context, and clearing a zero-byte session must not release others' data.
	responsesWSHTTPMemory.Store(responsesWSHTTPGlobalBytes)
	assert.False(t, h.remember("global-full", "main", "gpt-4o", []common.RawMessage{common.RawMessage(`{}`)}))
	assert.Empty(t, h.history)
	responsesWSHTTPMemory.Store(before)
}

func TestResponsesHTTPWebSocketContinuationKeepsRawItems(t *testing.T) {
	h := &responsesWSHTTPState{}
	defer h.clear()
	require.True(t, h.remember("p", "main", "gpt-4o", []common.RawMessage{common.RawMessage(`{"type":"reasoning","encrypted_content":"opaque","provider_extension":0}`)}))
	create, _, err := normalizeResponsesWSTestMessage([]byte(`{"type":"response.create","model":"gpt-4o","previous_response_id":"p","input":[{"type":"function_call_output","call_id":"call_1","output":"result"}],"include":["web_search_call.action.sources"],"max_output_tokens":0,"store":false}`))
	require.NoError(t, err)
	full, items, apiErr := h.expand(create)
	require.Nil(t, apiErr)
	require.Len(t, items, 2)
	require.NotNil(t, full.Request.MaxOutputTokens)
	assert.Zero(t, *full.Request.MaxOutputTokens)
	assert.NotContains(t, string(full.Body), "previous_response_id")
	assert.Contains(t, string(full.Body), `"provider_extension":0`)
	assert.Contains(t, string(full.Body), "web_search_call.action.sources")
	assert.Contains(t, string(full.Body), "reasoning.encrypted_content")
	assert.Contains(t, string(full.Body), `"store":false`)
}

func TestResponsesHTTPWebSocketHistoryMetadataBudget(t *testing.T) {
	before := responsesWSHTTPMemory.Load()
	h := &responsesWSHTTPState{}
	defer func() { h.clear(); assert.Equal(t, before, responsesWSHTTPMemory.Load()) }()
	require.True(t, h.remember("parent", "lane", "gpt-4o", nil))
	assert.GreaterOrEqual(t, h.bytes, int64(len("parentlanegpt-4o")))
	assert.Equal(t, h.bytes, responsesWSHTTPMemory.Load()-before)
	h.clear()
	// Metadata must be charged even when the item bytes alone fit the cap.
	item := common.RawMessage(strings.Repeat("x", responsesWSHTTPContextBytes-24))
	assert.False(t, h.remember("parent", "lane", "gpt-4o", []common.RawMessage{item}))
	for _, field := range []string{"id", "stream", "model"} {
		id, stream, model := "parent", "lane", "gpt-4o"
		switch field {
		case "id":
			id = strings.Repeat("i", 1025)
		case "stream":
			stream = strings.Repeat("s", 257)
		case "model":
			model = strings.Repeat("m", 1025)
		}
		assert.False(t, h.remember(id, stream, model, nil))
	}
	assert.Empty(t, h.history)
	assert.Equal(t, before, responsesWSHTTPMemory.Load())
	responsesWSHTTPMemory.Store(responsesWSHTTPGlobalBytes - 1)
	assert.False(t, h.remember("parent", "lane", "gpt-4o", nil))
	responsesWSHTTPMemory.Store(before)
}
