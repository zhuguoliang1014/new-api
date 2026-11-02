package controller

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResponsesHTTPWebSocketWarmupDoesNotBindUpstream(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	require.NoError(t, model.DB.Model(f.channel).Update("status", common.ChannelStatusManuallyDisabled).Error)
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","generate":false,"model":"ws-billing","input":"local prefix"}`)))
	terminal := readResponsesHTTPWSTerminal(t, f.client)
	assert.Equal(t, "response.completed", terminal["type"], "local warmup must not route, pin an account, or call the model")
}

func TestResponsesHTTPWebSocketReappliesSessionHeadersAfterWarmup(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	previous := *operation_setting.GetChannelAffinitySetting()
	t.Cleanup(func() { *operation_setting.GetChannelAffinitySetting() = previous })
	config := operation_setting.GetChannelAffinitySetting()
	config.Enabled = true
	config.Rules = []operation_setting.ChannelAffinityRule{{Name: "ws-cache-routing", ModelRegex: []string{"^ws-billing$"}, KeySources: []operation_setting.ChannelAffinityKeySource{{Type: "gjson", Path: "prompt_cache_key"}}, TTLSeconds: 600, ParamOverrideTemplate: map[string]any{"operations": []any{map[string]any{"mode": "pass_headers", "keep_origin": true, "value": []any{"Session_id", "Originator"}}}}}}
	// Replace the fixture's no-header socket with a real authenticated handshake
	// carrying the persistent client session metadata used by upstream routing.
	require.NoError(t, f.client.Close())
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(f.gatewayURL, "http")+"/v1/responses", http.Header{"Authorization": []string{"Bearer sk-" + f.token.Key}, "Session_id": []string{"same-session-after-restart"}, "Originator": []string{"codex_cli"}})
	require.NoError(t, err)
	defer client.Close()
	var calls atomic.Int32
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "same-session-after-restart", r.Header.Get("Session_id"), "session passthrough must not disappear after local warmup or later turns")
		assert.Equal(t, "codex_cli", r.Header.Get("Originator"))
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.Contains(t, string(body), `"prompt_cache_key":"stable-client-key"`)
		n := calls.Add(1)
		writeResponsesHTTPWSCompletion(t, w, fmt.Sprintf("cache_parent_%d", n), []any{})
	}
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","generate":false,"model":"ws-billing","input":[]}`)))
	require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, client)["type"])
	for _, payload := range []string{
		`{"type":"response.create","model":"ws-billing","prompt_cache_key":"stable-client-key","input":"initial"}`,
		`{"type":"response.create","model":"ws-billing","prompt_cache_key":"stable-client-key","previous_response_id":"cache_parent_1","input":"next"}`,
	} {
		require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(payload)))
		require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, client)["type"])
	}
	assert.Equal(t, int32(2), calls.Load())
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Order("id").Find(&logs).Error)
	require.Len(t, logs, 2)
	for _, l := range logs {
		assert.Contains(t, l.Other, "ws-cache-routing")
		assert.NotContains(t, l.Other, "same-session-after-restart")
	}
}

func TestResponsesHTTPWebSocketDoesNotPriceUnknownInputAsUncached(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `len > 10 ? tier("long", p * 4 + cr * 0.2 + c * 15) : tier("short", p * 2 + c * 1)`)
	previous := constant.CountToken
	constant.CountToken = true
	t.Cleanup(func() { constant.CountToken = previous })
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.created", "response": map[string]any{"id": "missing_usage", "status": "in_progress"}})
		writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.output_text.delta", "delta": "hello"})
		// Upstream disappears before reporting input/cache statistics.
	}
	payload, err := common.Marshal(map[string]any{"type": "response.create", "model": "ws-billing", "input": strings.Repeat("synthetic context ", 500), "max_output_tokens": 1})
	require.NoError(t, err)
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, payload))
	assert.Equal(t, "error", readResponsesHTTPWSTerminal(t, f.client)["type"])
	var rows []model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Find(&rows).Error)
	require.Len(t, rows, 1)
	assert.Zero(t, rows[0].PromptTokens, "unknown upstream input/cache usage must not become full-price uncached input")
	assert.Positive(t, rows[0].CompletionTokens)
	assert.Less(t, rows[0].Quota, 1000)
	var other map[string]any
	require.NoError(t, common.UnmarshalJsonStr(rows[0].Other, &other))
	admin := other["admin_info"].(map[string]any)
	assert.Equal(t, true, admin["input_usage_unavailable"])
	assert.Equal(t, "local", admin["usage_billing_path"])
	assert.Equal(t, "long", other["matched_tier"], "suppressing unknown input charges must not erase the context-length tier for delivered output")
	assert.Equal(t, "error", other["stream_status"].(map[string]any)["status"])
}

func TestResponsesHTTPWebSocketReconnectPreservesFullClientReplay(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	var calls atomic.Int32
	incoming := make(chan []byte, 3)
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		incoming <- body
		n := calls.Add(1)
		writeResponsesHTTPWSCompletion(t, w, fmt.Sprintf("reconnect_%d", n), []any{map[string]any{"type": "message", "id": "answer_original", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "saved answer", "annotations": []any{}}}}})
	}
	first := `{"type":"response.create","model":"ws-billing","prompt_cache_key":"same-thread-key","instructions":"stable prefix","input":[{"role":"user","content":"saved question"}]}`
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(first)))
	one := readResponsesHTTPWSTerminal(t, f.client)
	require.Equal(t, "response.completed", one["type"])
	response := one["response"].(map[string]any)
	firstBody := <-incoming
	require.NoError(t, f.client.Close())
	next, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(f.gatewayURL, "http")+"/v1/responses", http.Header{"Authorization": []string{"Bearer sk-" + f.token.Key}})
	require.NoError(t, err)
	defer next.Close()
	input := []any{map[string]any{"role": "user", "content": "saved question"}}
	input = append(input, response["output"].([]any)...)
	input = append(input, map[string]any{"role": "user", "content": "new turn after restart"})
	payload, err := common.Marshal(map[string]any{"type": "response.create", "model": "ws-billing", "prompt_cache_key": "same-thread-key", "instructions": "stable prefix", "input": input})
	require.NoError(t, err)
	require.NoError(t, next.WriteMessage(websocket.TextMessage, payload))
	require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, next)["type"])
	secondBody := <-incoming
	var a, b map[string]common.RawMessage
	require.NoError(t, common.Unmarshal(firstBody, &a))
	require.NoError(t, common.Unmarshal(secondBody, &b))
	assert.JSONEq(t, string(a["prompt_cache_key"]), string(b["prompt_cache_key"]))
	assert.JSONEq(t, string(a["instructions"]), string(b["instructions"]))
	expected, err := common.Marshal(input)
	require.NoError(t, err)
	assert.JSONEq(t, string(expected), string(b["input"]), "fresh connection must forward the client's full replay without replacing, duplicating or trimming history")
	assert.NotContains(t, b, "previous_response_id")
	assert.Equal(t, int32(2), calls.Load())
}

func TestResponsesHTTPWebSocketRecordsStandardUpstreamRequestID(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Request-ID", "provider-cache-trace")
		writeResponsesHTTPWSCompletion(t, w, "trace_parent", []any{})
	}
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"trace"}`)))
	require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
	var rows []model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Find(&rows).Error)
	require.Len(t, rows, 1)
	assert.Equal(t, "provider-cache-trace", rows[0].UpstreamRequestId)
}
