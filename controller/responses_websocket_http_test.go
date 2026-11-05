package controller

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newResponsesHTTPWSFixture(t *testing.T, expression string) *responsesWSBillingTest {
	t.Helper()
	fixture := newResponsesWSTransportTest(t, true, expression, func(*websocket.Conn, *http.Request) { t.Error("HTTP bridge must not dial upstream WebSocket") })
	t.Cleanup(func() { fixture.closeAndWait(t) })
	return fixture
}

func readResponsesHTTPWSTerminal(t *testing.T, client *websocket.Conn) map[string]any {
	t.Helper()
	for range 100 {
		event := readResponsesWSTestEvent(t, client)
		switch event["type"] {
		case "response.completed", "response.done", "response.failed", "response.incomplete", "error":
			return event
		}
	}
	t.Fatal("no terminal response")
	return nil
}

func writeResponsesHTTPWSEvent(t *testing.T, w http.ResponseWriter, payload any) {
	t.Helper()
	body, err := common.Marshal(payload)
	require.NoError(t, err)
	_, err = fmt.Fprintf(w, "data: %s\n\n", body)
	require.NoError(t, err)
	w.(http.Flusher).Flush()
}

func writeResponsesHTTPWSCompletion(t *testing.T, w http.ResponseWriter, id string, output []any) {
	t.Helper()
	w.Header().Set("Content-Type", "text/event-stream")
	writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.created", "response": map[string]any{"id": id, "status": "in_progress"}})
	writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.completed", "response": map[string]any{"id": id, "status": "completed", "model": "gpt-4o", "output": output, "usage": map[string]any{"input_tokens": 1000, "output_tokens": 10, "total_tokens": 1010}}})
}

func TestResponsesHTTPWebSocketReconstructsToolHistoryAndSettles(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("input", p * 2)`)
	var calls atomic.Int32
	received := make(chan map[string]common.RawMessage, 3)
	firstOutput := []any{
		map[string]any{"id": "rs_1", "type": "reasoning", "encrypted_content": "opaque-reasoning", "summary": []any{}, "vendor": map[string]any{"kept": true}},
		map[string]any{"id": "fc_1", "type": "function_call", "call_id": "call_1", "name": "read_file", "arguments": `{"path":"example"}`, "status": "completed"},
	}
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "Bearer upstream-first", r.Header.Get("Authorization"))
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		var raw map[string]common.RawMessage
		require.NoError(t, common.Unmarshal(body, &raw))
		received <- raw
		call := calls.Add(1)
		output := []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "done"}}}}
		if call == 1 {
			output = firstOutput
		}
		writeResponsesHTTPWSCompletion(t, w, fmt.Sprintf("bridge_%d", call), output)
	}
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","stream_id":"main","model":"ws-billing","input":"initial","store":false}`)))
	first := readResponsesHTTPWSTerminal(t, f.client)
	require.Equal(t, "response.completed", first["type"])
	require.Equal(t, "main", first["stream_id"])
	raw := <-received
	assert.JSONEq(t, `[{"type":"message","role":"user","content":"initial"}]`, string(raw["input"]))
	assert.JSONEq(t, `["reasoning.encrypted_content"]`, string(raw["include"]))
	assert.Equal(t, "true", string(raw["stream"]))
	assert.Equal(t, "false", string(raw["store"]))
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","stream_id":"main","model":"ws-billing","previous_response_id":"bridge_1","input":[{"type":"function_call_output","call_id":"call_1","output":"file contents"}],"store":false}`)))
	second := readResponsesHTTPWSTerminal(t, f.client)
	require.Equal(t, "response.completed", second["type"])
	raw = <-received
	assert.NotContains(t, raw, "previous_response_id")
	var input []map[string]any
	require.NoError(t, common.Unmarshal(raw["input"], &input))
	require.Len(t, input, 4)
	assert.Equal(t, "initial", input[0]["content"])
	assert.Equal(t, "opaque-reasoning", input[1]["encrypted_content"])
	assert.Equal(t, map[string]any{"kept": true}, input[1]["vendor"])
	assert.Equal(t, "call_1", input[2]["call_id"])
	assert.Equal(t, "function_call_output", input[3]["type"])
	require.Equal(t, int32(0), f.connections.Load())
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Order("id").Find(&logs).Error)
	require.Len(t, logs, 2)
	for i, l := range logs {
		assert.Equal(t, 1000, l.Quota)
		assert.Equal(t, f.user.Id, l.UserId)
		assert.Equal(t, f.channel.Id, l.ChannelId)
		assert.True(t, strings.HasSuffix(l.RequestId, fmt.Sprintf("-ws-%d", i)))
		var other map[string]any
		require.NoError(t, common.UnmarshalJsonStr(l.Other, &other))
		admin := other["admin_info"].(map[string]any)
		assert.Equal(t, "websocket", admin["downstream_transport"])
		assert.Equal(t, "http", admin["upstream_transport"])
	}
	require.NoError(t, model.DB.First(f.token, f.token.Id).Error)
	assert.Equal(t, 1000, f.token.RemainQuota)
}

func TestResponsesHTTPWebSocketIsolatesConnectionsAndLanes(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	var calls atomic.Int32
	received := make(chan string, 5)
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		received <- string(raw)
		index := calls.Add(1)
		writeResponsesHTTPWSCompletion(t, w, fmt.Sprintf("isolated_%d", index), []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": fmt.Sprintf("answer-%d", index)}}}})
	}
	for _, payload := range []string{
		`{"type":"response.create","stream_id":"A","model":"ws-billing","input":"private-A"}`,
		`{"type":"response.create","stream_id":"B","model":"ws-billing","input":"private-B"}`,
		`{"type":"response.create","stream_id":"A","model":"ws-billing","previous_response_id":"isolated_1","input":"continue-A"}`,
	} {
		require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(payload)))
		require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
	}
	<-received
	second := <-received
	third := <-received
	assert.NotContains(t, second, "private-A")
	assert.Contains(t, third, "private-A")
	assert.Contains(t, third, "answer-1")
	assert.NotContains(t, third, "private-B")
	assert.NotContains(t, third, "answer-2")
	// A second physical connection cannot claim a response from the first,
	// even when both connections belong to exactly the same API token.
	secondClient, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(f.gatewayURL, "http")+"/v1/responses", http.Header{"Authorization": []string{"Bearer sk-" + f.token.Key}})
	require.NoError(t, err)
	defer secondClient.Close()
	require.NoError(t, secondClient.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","previous_response_id":"isolated_3","input":"steal"}`)))
	rejection := readResponsesHTTPWSTerminal(t, secondClient)
	require.Equal(t, "error", rejection["type"])
	assert.Equal(t, "previous_response_not_found", rejection["error"].(map[string]any)["code"])
	assert.Equal(t, int32(3), calls.Load())
	// Full replay recovers a fresh connection without ever forwarding a
	// caller-provided, unowned upstream previous_response_id.
	require.NoError(t, secondClient.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"fresh-context"}`)))
	require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, secondClient)["type"])
	assert.NotContains(t, <-received, "private-A")
}

func TestResponsesHTTPWebSocketWarmupIsLocalAndInvalidInputDoesNotCharge(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0.002))`)
	var calls atomic.Int32
	received := make(chan string, 1)
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		received <- string(body)
		calls.Add(1)
		writeResponsesHTTPWSCompletion(t, w, "warm_final", []any{})
	}
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","generate":false,"input":"warm-prefix"}`)))
	warm := readResponsesHTTPWSTerminal(t, f.client)
	require.Equal(t, "response.completed", warm["type"])
	id := warm["response"].(map[string]any)["id"].(string)
	require.True(t, strings.HasPrefix(id, "resp_newapi_"))
	assert.Zero(t, calls.Load())
	var count int64
	require.NoError(t, model.LOG_DB.Model(&model.Log{}).Where("token_id = ?", f.token.Id).Count(&count).Error)
	assert.Zero(t, count)
	require.NoError(t, model.DB.First(f.token, f.token.Id).Error)
	assert.Equal(t, 3000, f.token.RemainQuota)
	for _, payload := range []string{
		`{"type":"response.create","model":"ws-billing","generate":"false","input":"bad"}`,
		`{"type":"response.create","model":"ws-billing","max_output_tokens":18446744073709551615,"input":"bad"}`,
		`{"type":"response.create","model":"ws-billing","conversation":"unowned","input":"bad"}`,
		`{"type":"response.create","model":"ws-billing","input":123}`,
		`{"type":"response.create","model":"ws-billing","input":[{"type":"item_reference","id":"unowned"}]}`,
	} {
		require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(payload)))
		assert.Equal(t, "error", readResponsesHTTPWSTerminal(t, f.client)["type"])
	}
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"response.create","model":"ws-billing","previous_response_id":%q,"input":"new-input"}`, id))))
	require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
	body := <-received
	assert.Contains(t, body, "warm-prefix")
	assert.Contains(t, body, "new-input")
	assert.NotContains(t, body, "previous_response_id")
	assert.Equal(t, int32(1), calls.Load())
	require.NoError(t, model.DB.First(f.token, f.token.Id).Error)
	assert.Equal(t, 2000, f.token.RemainQuota)
}

func TestResponsesHTTPWebSocketRechecksTokenBeforeContinuation(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("input", p * 2)`)
	var calls atomic.Int32
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		writeResponsesHTTPWSCompletion(t, w, "revoke_parent", []any{})
	}
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"hello"}`)))
	require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
	f.token.Status = common.TokenStatusDisabled
	require.NoError(t, f.token.SelectUpdate())
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","previous_response_id":"revoke_parent","input":"next"}`)))
	reject := readResponsesHTTPWSTerminal(t, f.client)
	assert.Equal(t, float64(http.StatusUnauthorized), reject["status"])
	assert.Equal(t, int32(1), calls.Load())
}

func TestResponsesHTTPWebSocketCancelsHTTPSAndDoesNotReplay(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("output", c * 2000)`)
	var calls atomic.Int32
	cancelled := make(chan struct{})
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.created", "response": map[string]any{"id": "active", "status": "in_progress"}})
		writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.output_text.delta", "delta": "hello"})
		<-r.Context().Done()
		close(cancelled)
	}
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","stream_id":"main","model":"ws-billing","input":"hello"}`)))
	assert.Equal(t, "response.created", readResponsesWSTestEvent(t, f.client)["type"])
	assert.Equal(t, "response.output_text.delta", readResponsesWSTestEvent(t, f.client)["type"])
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.cancel","event_id":"wrong","stream_id":"other","response_id":"active"}`)))
	errEvent := readResponsesHTTPWSTerminal(t, f.client)
	assert.Equal(t, "wrong", errEvent["event_id"])
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.cancel","stream_id":"main","response_id":"active"}`)))
	terminal := readResponsesHTTPWSTerminal(t, f.client)
	assert.Equal(t, "error", terminal["type"])
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP request was not cancelled")
	}
	assert.Equal(t, int32(1), calls.Load())
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Positive(t, logs[0].Quota, "delivered output remains billable exactly once")
}

func TestResponsesHTTPWebSocketInterruptDiscardsPartialItemsAndContinues(t *testing.T) {
	for _, reportedUsage := range []bool{false, true} {
		t.Run(fmt.Sprintf("reported_usage=%v", reportedUsage), func(t *testing.T) {
			f := newResponsesHTTPWSFixture(t, `tier("tokens", p * 2 + c * 2)`)
			var calls atomic.Int32
			cancelled := make(chan struct{})
			reasoning := map[string]any{"id": "rs_complete", "type": "reasoning", "encrypted_content": "preserved", "summary": []any{}}
			f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
				body, err := io.ReadAll(r.Body)
				require.NoError(t, err)
				if calls.Add(1) != 1 {
					assert.Contains(t, string(body), "seed input")
					assert.Contains(t, string(body), "preserved")
					assert.NotContains(t, string(body), "fc_partial")
					assert.NotContains(t, string(body), "previous_response_id")
					writeResponsesHTTPWSCompletion(t, w, "continued", []any{})
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				response := map[string]any{"id": "active", "status": "in_progress"}
				if reportedUsage {
					response["usage"] = map[string]any{"input_tokens": 1000, "output_tokens": 10, "total_tokens": 1010}
				}
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.created", "response": response})
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": reasoning})
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.output_item.added", "output_index": 1, "item": map[string]any{"id": "fc_partial", "type": "function_call", "status": "in_progress"}})
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.function_call_arguments.delta", "delta": "partial"})
				<-r.Context().Done()
				close(cancelled)
			}
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","stream_id":"main","model":"ws-billing","input":"seed input","generate":false}`)))
			warmup := readResponsesHTTPWSTerminal(t, f.client)
			parent := warmup["response"].(map[string]any)["id"]
			create, err := common.Marshal(map[string]any{"type": "response.create", "stream_id": "main", "model": "ws-billing", "previous_response_id": parent, "input": "start"})
			require.NoError(t, err)
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, create))
			for _, kind := range []string{"response.created", "response.output_item.done", "response.output_item.added", "response.function_call_arguments.delta"} {
				require.Equal(t, kind, readResponsesWSTestEvent(t, f.client)["type"])
			}
			other, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(f.gatewayURL, "http")+"/v1/responses", http.Header{"Authorization": []string{"Bearer sk-" + f.token.Key}})
			require.NoError(t, err)
			defer other.Close()
			require.NoError(t, other.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.interrupt","response_id":"active","mode":"discard_partial_items"}`)))
			assert.Equal(t, "response.interrupt.failed", readResponsesWSTestEvent(t, other)["type"])
			assert.Empty(t, cancelled, "another connection cannot interrupt this response")
			for _, tc := range []struct{ payload, kind string }{
				{`{"type":"response.interrupt","event_id":"invalid","response_id":"active","mode":"unknown"}`, "error"},
				{`{"type":"response.interrupt","event_id":"invalid","mode":"discard_partial_items"}`, "error"},
				{`{"type":"response.interrupt","event_id":"invalid","response_id":"other","mode":"discard_partial_items"}`, "response.interrupt.failed"},
				{`{"type":"response.interrupt","event_id":"invalid","response_id":"active","stream_id":"other","mode":"discard_partial_items"}`, "response.interrupt.failed"},
			} {
				require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(tc.payload)))
				event := readResponsesWSTestEvent(t, f.client)
				assert.Equal(t, tc.kind, event["type"])
				assert.Equal(t, "invalid", event["event_id"])
				assert.Empty(t, cancelled, "invalid controls must leave the generation running")
			}
			interrupt := []byte(`{"type":"response.interrupt","event_id":"stop","response_id":"active","stream_id":"main","mode":"discard_partial_items"}`)
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, interrupt))
			ack := readResponsesWSTestEvent(t, f.client)
			assert.Equal(t, "response.interrupt.accepted", ack["type"])
			assert.Equal(t, "active", ack["response_id"])
			assert.Equal(t, "main", ack["stream_id"])
			terminal := readResponsesHTTPWSTerminal(t, f.client)
			require.Equal(t, "response.incomplete", terminal["type"])
			response := terminal["response"].(map[string]any)
			assert.Equal(t, "interrupted", response["incomplete_details"].(map[string]any)["reason"])
			output, err := common.Marshal(response["output"])
			require.NoError(t, err)
			assert.JSONEq(t, `[{"id":"rs_complete","type":"reasoning","encrypted_content":"preserved","summary":[]}]`, string(output))
			if reportedUsage {
				assert.Equal(t, float64(1000), response["usage"].(map[string]any)["input_tokens"])
			} else {
				assert.Nil(t, response["usage"], "unknown upstream usage must not be fabricated")
			}
			select {
			case <-cancelled:
			case <-time.After(3 * time.Second):
				t.Fatal("interrupt did not cancel the HTTP generation")
			}
			// Duplicate and completion-race controls are acknowledged without a
			// second generation, settlement, or mutation of the next request.
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, interrupt))
			assert.Equal(t, "response.interrupt.accepted", readResponsesWSTestEvent(t, f.client)["type"])
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","stream_id":"main","model":"ws-billing","previous_response_id":"active","input":"continue"}`)))
			require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.interrupt","response_id":"continued","mode":"discard_partial_items"}`)))
			assert.Equal(t, "response.interrupt.accepted", readResponsesWSTestEvent(t, f.client)["type"])
			assert.Equal(t, int32(2), calls.Load())
			var logs []model.Log
			require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Order("id").Find(&logs).Error)
			require.Len(t, logs, 2)
			if reportedUsage {
				assert.Equal(t, 1010, logs[0].Quota)
			} else {
				assert.Zero(t, logs[0].PromptTokens)
				assert.Positive(t, logs[0].Quota, "generated output is settled once")
			}
			assertResponsesWSAccounting(t, f, []int{logs[0].Quota, 1010})
		})
	}
}

func TestResponsesWebSocketForwardsInterruptHandshake(t *testing.T) {
	interrupt := `{"type":"response.interrupt","event_id":"stop","response_id":"active","mode":"discard_partial_items"}`
	f := newResponsesWSBillingTest(t, `tier("input", p * 2)`, func(ws *websocket.Conn, r *http.Request) {
		_, _, err := ws.ReadMessage()
		if !assert.NoError(t, err) {
			return
		}
		if !assert.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.created","response":{"id":"active","status":"in_progress"}}`))) {
			return
		}
		for _, terminal := range []bool{true, false} {
			_, body, err := ws.ReadMessage()
			if !assert.NoError(t, err) || !assert.JSONEq(t, interrupt, string(body)) {
				return
			}
			if !assert.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.interrupt.accepted","response_id":"active"}`))) {
				return
			}
			if terminal {
				if !assert.NoError(t, ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.incomplete","response":{"id":"active","status":"incomplete","incomplete_details":{"reason":"interrupted"},"usage":{"input_tokens":1000,"output_tokens":10,"total_tokens":1010}}}`))) {
					return
				}
			}
		}
		_, _, _ = ws.ReadMessage()
	})
	t.Cleanup(func() { f.closeAndWait(t) })
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"start"}`)))
	require.Equal(t, "response.created", readResponsesWSTestEvent(t, f.client)["type"])
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(interrupt)))
	assert.Equal(t, "response.interrupt.accepted", readResponsesWSTestEvent(t, f.client)["type"])
	require.Equal(t, "response.incomplete", readResponsesHTTPWSTerminal(t, f.client)["type"])
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(interrupt)))
	assert.Equal(t, "response.interrupt.accepted", readResponsesWSTestEvent(t, f.client)["type"])
	assertResponsesWSAccounting(t, f, []int{1000})
}

func TestResponsesHTTPWebSocketInterruptRacingSettledCompletion(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("input", p * 2)`)
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		writeResponsesHTTPWSCompletion(t, w, "finished", []any{})
	}
	settled, release := make(chan struct{}), make(chan struct{})
	releaseRunner := sync.OnceFunc(func() { close(release) })
	defer releaseRunner()
	engine := gin.New()
	engine.GET("/v1/responses", func(c *gin.Context) {
		client, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		require.NoError(t, err)
		defer client.Close()
		runner := newResponsesWSRequestRunner(c)
		apiErr := relay.ResponsesHTTPWebSocketHelper(c, client, func(request *http.Request, id string, handle func(*gin.Context) *types.NewAPIError) *types.NewAPIError {
			apiErr := runner(request, id, handle)
			close(settled)
			<-release
			return apiErr
		})
		assert.Nil(t, apiErr)
	})
	gateway := httptest.NewServer(engine)
	defer func() { releaseRunner(); gateway.Close() }()
	client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(gateway.URL, "http")+"/v1/responses", http.Header{"Authorization": []string{"Bearer sk-" + f.token.Key}})
	require.NoError(t, err)
	defer client.Close()
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"start"}`)))
	require.Equal(t, "response.created", readResponsesWSTestEvent(t, client)["type"])
	select {
	case <-settled:
	case <-time.After(3 * time.Second):
		t.Fatal("request did not settle")
	}
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.interrupt","response_id":"finished","mode":"discard_partial_items"}`)))
	// The conflict confirms the earlier interrupt was enqueued after the HTTP
	// watcher stopped, while the settled turn still owns admission.
	require.NoError(t, client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"conflict"}`)))
	conflict := readResponsesWSTestEvent(t, client)
	require.Equal(t, float64(http.StatusConflict), conflict["status"])
	releaseRunner()
	assert.Equal(t, "response.interrupt.accepted", readResponsesWSTestEvent(t, client)["type"])
	assert.Equal(t, "response.completed", readResponsesWSTestEvent(t, client)["type"])
	assertResponsesWSAccounting(t, f, []int{1000})
}

func TestResponsesHTTPWebSocketUpstreamFailureRefundsAndAllowsHTTPS(t *testing.T) {
	for _, partial := range []bool{false, true} {
		t.Run(fmt.Sprintf("partial=%v", partial), func(t *testing.T) {
			f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0.002))`)
			var calls atomic.Int32
			f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if !partial {
					w.WriteHeader(http.StatusServiceUnavailable)
					_, _ = io.WriteString(w, `{"error":{"type":"server_error","message":"unavailable"}}`)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.created", "response": map[string]any{"id": "unfinished", "status": "in_progress"}})
			}
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"hello"}`)))
			assert.Equal(t, "error", readResponsesHTTPWSTerminal(t, f.client)["type"])
			assert.Equal(t, int32(1), calls.Load(), "no application retry after ambiguous submission")
			require.NoError(t, model.DB.First(f.token, f.token.Id).Error)
			if !partial {
				require.Eventually(t, func() bool {
					return model.DB.First(f.token, f.token.Id).Error == nil && f.token.RemainQuota == 3000
				}, 3*time.Second, 10*time.Millisecond, "initial rejection refunds reservation")
			}
			// Plain HTTPS clients use the unchanged POST endpoint independently.
			f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				writeResponsesHTTPWSCompletion(t, w, "http_fallback", []any{})
			}
			req, err := http.NewRequest(http.MethodPost, f.gatewayURL+"/v1/responses", strings.NewReader(`{"model":"ws-billing","input":"full replay","stream":true}`))
			require.NoError(t, err)
			req.Header.Set("Authorization", "Bearer sk-"+f.token.Key)
			req.Header.Set("Content-Type", "application/json")
			resp, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
			require.NoError(t, err)
			body, err := io.ReadAll(resp.Body)
			require.NoError(t, err)
			require.NoError(t, resp.Body.Close())
			assert.Equal(t, http.StatusOK, resp.StatusCode)
			assert.Contains(t, string(body), "http_fallback")
			assert.Equal(t, int32(2), calls.Load())
		})
	}
}

func TestResponsesHTTPWebSocketRejectsCrossOrigin(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	client, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(f.gatewayURL, "http")+"/v1/responses", http.Header{"Authorization": []string{"Bearer sk-" + f.token.Key}, "Origin": []string{"https://untrusted.example"}})
	if client != nil {
		defer client.Close()
	}
	require.Error(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
	require.NoError(t, resp.Body.Close())
}

func TestResponsesHTTPWebSocketHundredUsersStayIsolated(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	const users = 100
	var calls atomic.Int32
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		var body struct {
			Input []struct {
				Role    string            `json:"role"`
				Content common.RawMessage `json:"content"`
			} `json:"input"`
		}
		require.NoError(t, common.Unmarshal(raw, &body))
		var marker string
		for _, item := range body.Input {
			if item.Role == "user" {
				var text string
				if common.Unmarshal(item.Content, &text) == nil && strings.HasPrefix(text, "isolated-user-") {
					if marker != "" && marker != text {
						t.Errorf("upstream input contains two users: %q and %q", marker, text)
					}
					marker = text
				}
			}
		}
		require.NotEmpty(t, marker)
		index := calls.Add(1)
		writeResponsesHTTPWSCompletion(t, w, fmt.Sprintf("hundred_%d", index), []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": marker}}}})
	}
	type clientIdentity struct {
		client          *websocket.Conn
		userID, tokenID int
		marker          string
	}
	identities := make([]clientIdentity, 0, users)
	t.Cleanup(func() {
		for _, v := range identities {
			_ = v.client.Close()
			require.NoError(t, model.LOG_DB.Where("token_id = ?", v.tokenID).Delete(&model.Log{}).Error)
			require.NoError(t, model.DB.Unscoped().Delete(&model.Token{}, v.tokenID).Error)
			require.NoError(t, model.DB.Unscoped().Delete(&model.User{}, v.userID).Error)
		}
	})
	for i := range users {
		user := &model.User{Id: 5062000 + int(responsesWSTestUserSequence.Add(1)), Username: fmt.Sprintf("ws-http-user-%d", i), AffCode: fmt.Sprintf("ws-http-aff-%d", i), Status: common.UserStatusEnabled, Role: common.RoleCommonUser, Group: "default", Quota: 10000, AuthVersion: 1}
		require.NoError(t, model.DB.Create(user).Error)
		token := &model.Token{UserId: user.Id, Key: fmt.Sprintf("bridgeisolation%d", i), Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 1000, Group: "default"}
		require.NoError(t, model.DB.Create(token).Error)
		client, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(f.gatewayURL, "http")+"/v1/responses", http.Header{"Authorization": []string{"Bearer sk-" + token.Key}})
		require.NoError(t, err)
		identities = append(identities, clientIdentity{client: client, userID: user.Id, tokenID: token.Id, marker: fmt.Sprintf("isolated-user-%d", i)})
	}
	var wg sync.WaitGroup
	for _, v := range identities {
		wg.Go(func() {
			first, err := common.Marshal(map[string]any{"type": "response.create", "model": "ws-billing", "input": v.marker})
			require.NoError(t, err)
			require.NoError(t, v.client.WriteMessage(websocket.TextMessage, first))
			event := readResponsesHTTPWSTerminal(t, v.client)
			require.Equal(t, "response.completed", event["type"])
			response := event["response"].(map[string]any)
			id := response["id"].(string)
			follow, err := common.Marshal(map[string]any{"type": "response.create", "model": "ws-billing", "previous_response_id": id, "input": "continue only my context"})
			require.NoError(t, err)
			require.NoError(t, v.client.WriteMessage(websocket.TextMessage, follow))
			event = readResponsesHTTPWSTerminal(t, v.client)
			require.Equal(t, "response.completed", event["type"])
			output := event["response"].(map[string]any)["output"].([]any)
			content := output[0].(map[string]any)["content"].([]any)
			assert.Equal(t, v.marker, content[0].(map[string]any)["text"])
		})
	}
	wg.Wait()
	assert.Equal(t, int32(users*2), calls.Load())
	requestIDs := map[string]bool{}
	for _, v := range identities {
		var logs []model.Log
		require.NoError(t, model.LOG_DB.Where("token_id = ?", v.tokenID).Order("id").Find(&logs).Error)
		require.Len(t, logs, 2)
		for _, l := range logs {
			assert.Equal(t, v.userID, l.UserId)
			assert.Equal(t, f.channel.Id, l.ChannelId)
			assert.Zero(t, l.Quota)
			assert.False(t, requestIDs[l.RequestId], "request ids must remain unique across clients")
			requestIDs[l.RequestId] = true
		}
		var token model.Token
		require.NoError(t, model.DB.First(&token, v.tokenID).Error)
		assert.Equal(t, 1000, token.RemainQuota)
	}
}

func TestResponsesHTTPWebSocketWorksWithHTTPSOnlyChannel(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	setting := `{"responses_websocket_enabled":false,"proxy":""}`
	require.NoError(t, model.DB.Model(f.channel).Update("setting", setting).Error)
	var calls atomic.Int32
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		writeResponsesHTTPWSCompletion(t, w, fmt.Sprintf("https_only_%d", n), []any{})
	}
	for _, input := range []string{
		`{"type":"response.create","model":"ws-billing","input":"initial"}`,
		`{"type":"response.create","model":"ws-billing","previous_response_id":"https_only_1","input":"continue"}`,
	} {
		require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(input)))
		require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
	}
	assert.Equal(t, int32(2), calls.Load())
	assert.Zero(t, f.connections.Load())
}

func TestResponsesHTTPWebSocketOverridesCannotRestoreUpstreamState(t *testing.T) {
	for _, mode := range []string{"overrides", "channel-passthrough", "global-passthrough"} {
		t.Run(mode, func(t *testing.T) {
			f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
			settings := model_setting.GetGlobalSettings()
			previous := settings.PassThroughRequestEnabled
			settings.PassThroughRequestEnabled = mode == "global-passthrough"
			t.Cleanup(func() { settings.PassThroughRequestEnabled = previous })
			require.NoError(t, model.DB.Model(f.channel).Updates(map[string]any{
				"param_override": `{"previous_response_id":"unowned-upstream-parent","stream":false}`,
				"setting":        fmt.Sprintf(`{"pass_through_body_enabled":%v}`, mode == "channel-passthrough"),
			}).Error)
			f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
				body, err := io.ReadAll(r.Body)
				require.NoError(t, err)
				var raw map[string]common.RawMessage
				require.NoError(t, common.Unmarshal(body, &raw))
				assert.NotContains(t, raw, "previous_response_id")
				assert.Equal(t, "true", string(raw["stream"]))
				assert.Contains(t, string(raw["input"]), "private-input")
				writeResponsesHTTPWSCompletion(t, w, "override_safe", []any{})
			}
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"private-input"}`)))
			assert.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
		})
	}
}

func TestResponsesHTTPWebSocketDisconnectCancelsAndSettlesOnce(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("output", c * 2000)`)
	var calls atomic.Int32
	cancelled := make(chan struct{})
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.created", "response": map[string]any{"id": "disconnected", "status": "in_progress"}})
		writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.output_text.delta", "delta": "hello"})
		<-r.Context().Done()
		close(cancelled)
	}
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"hello"}`)))
	assert.Equal(t, "response.created", readResponsesWSTestEvent(t, f.client)["type"])
	assert.Equal(t, "response.output_text.delta", readResponsesWSTestEvent(t, f.client)["type"])
	require.NoError(t, f.client.Close())
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("disconnect did not cancel HTTP upstream")
	}
	var logs []model.Log
	require.Eventually(t, func() bool {
		return model.LOG_DB.Where("token_id = ?", f.token.Id).Find(&logs).Error == nil && len(logs) == 1
	}, 3*time.Second, 10*time.Millisecond)
	assert.Positive(t, logs[0].Quota)
	assert.Equal(t, int32(1), calls.Load())
	require.NoError(t, model.DB.First(f.token, f.token.Id).Error)
	assert.Equal(t, 3000-logs[0].Quota, f.token.RemainQuota)
}

func TestResponsesHTTPWebSocketAutoGroupContinuation(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	previousGroups := setting.UserUsableGroups2JSONString()
	previousAuto := setting.AutoGroups2JsonString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousGroups))
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(previousAuto))
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","auto":"Auto"}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["default"]`))
	require.NoError(t, model.DB.First(f.token, f.token.Id).Error)
	f.token.Group = "auto"
	require.NoError(t, f.token.Update())
	var calls atomic.Int32
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		writeResponsesHTTPWSCompletion(t, w, fmt.Sprintf("auto_%d", calls.Add(1)), []any{})
	}
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"first"}`)))
	require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","previous_response_id":"auto_1","input":"second"}`)))
	event := readResponsesHTTPWSTerminal(t, f.client)
	assert.Equal(t, "response.completed", event["type"], "a valid auto-group token must support a second turn")
	assert.Equal(t, int32(2), calls.Load())
}

func TestResponsesHTTPWebSocketTerminalDoesNotWaitForUpstreamEOF(t *testing.T) {
	for _, kind := range []string{"response.completed", "response.done", "response.incomplete", "response.failed", "response.cancelled", "response.canceled", "error", "response.error"} {
		t.Run(kind, func(t *testing.T) {
			f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
			release := make(chan struct{})
			defer close(release)
			var calls atomic.Int32
			f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) > 1 {
					writeResponsesHTTPWSCompletion(t, w, "after_terminal", []any{})
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.created", "response": map[string]any{"id": "terminal_wait", "status": "in_progress"}})
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": kind, "response": map[string]any{"id": "terminal_wait", "status": strings.TrimPrefix(kind, "response."), "incomplete_details": map[string]any{"reason": "max_output_tokens"}, "output": []any{}, "usage": map[string]any{"input_tokens": 10, "output_tokens": 1, "total_tokens": 11}}})
				select {
				case <-release:
				case <-r.Context().Done():
				}
			}
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"hello"}`)))
			require.Equal(t, "response.created", readResponsesWSTestEvent(t, f.client)["type"])
			require.Equal(t, kind, readResponsesWSTestEvent(t, f.client)["type"], "terminal must arrive while the upstream body is still open")
			require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","input":"next"}`)))
			require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
			assert.Equal(t, int32(2), calls.Load())
			var logs []model.Log
			require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Order("id").Find(&logs).Error)
			require.Len(t, logs, 2, "each turn settles exactly once")
			assert.Equal(t, 10, logs[0].PromptTokens)
			assert.Equal(t, 1, logs[0].CompletionTokens)
		})
	}
}

func TestResponsesHTTPWebSocketRejectsOversizedMetadata(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) { t.Error("invalid requests must remain local") }
	for _, field := range []string{"model", "previous_response_id"} {
		request := map[string]any{"type": "response.create", "model": "ws-billing", "input": []any{}, "generate": false}
		request[field] = strings.Repeat("m", 1<<20)
		payload, err := common.Marshal(request)
		require.NoError(t, err)
		require.NoError(t, f.client.WriteMessage(websocket.TextMessage, payload))
		event := readResponsesHTTPWSTerminal(t, f.client)
		require.Equal(t, "error", event["type"])
		assert.Equal(t, float64(http.StatusBadRequest), event["status"])
	}
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create","model":"ws-billing","generate":false,"input":[]}`)))
	require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Find(&logs).Error)
	assert.Empty(t, logs)
}

func TestResponsesHTTPWebSocketCompletedMissingUsageMatchesHTTPFallback(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("input", p * 2)`)
	constant.CountToken = true
	var calls atomic.Int32
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		id := fmt.Sprintf("no_usage_%d", calls.Add(1))
		writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.created", "response": map[string]any{"id": id, "status": "in_progress"}})
		writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.completed", "response": map[string]any{"id": id, "status": "completed", "model": "gpt-4o", "output": []any{map[string]any{"type": "message", "role": "assistant", "content": []any{map[string]any{"type": "output_text", "text": "done"}}}}}})
	}
	payload := `{"model":"ws-billing","input":"Please count these ordinary words as input tokens for this complete response.","stream":true}`
	require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(`{"type":"response.create",`+payload[1:])))
	require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
	req, err := http.NewRequest(http.MethodPost, f.gatewayURL+"/v1/responses", strings.NewReader(payload))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer sk-"+f.token.Key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 3 * time.Second}).Do(req)
	require.NoError(t, err)
	_, err = io.ReadAll(resp.Body)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	<-f.httpDone
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Order("id").Find(&logs).Error)
	require.Len(t, logs, 2)
	require.Positive(t, logs[1].PromptTokens)
	assert.Equal(t, logs[1].PromptTokens, logs[0].PromptTokens)
	assert.Equal(t, logs[1].Quota, logs[0].Quota)
}

func TestResponsesHTTPWebSocketAzureContinuationKeepsAPIVersion(t *testing.T) {
	previousVersion := constant.AzureDefaultAPIVersion
	constant.AzureDefaultAPIVersion = "2025-04-01-preview"
	t.Cleanup(func() { constant.AzureDefaultAPIVersion = previousVersion })
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
	baseURL := *f.channel.BaseURL + "/cognitiveservices.azure.com"
	require.NoError(t, model.DB.Model(f.channel).Updates(map[string]any{"type": constant.ChannelTypeAzure, "other": "2025-03-01-preview", "base_url": baseURL}).Error)
	versions := make(chan string, 2)
	var calls atomic.Int32
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		versions <- r.URL.Query().Get("api-version")
		writeResponsesHTTPWSCompletion(t, w, fmt.Sprintf("azure_%d", calls.Add(1)), []any{})
	}
	for _, payload := range []string{
		`{"type":"response.create","model":"ws-billing","input":"first"}`,
		`{"type":"response.create","model":"ws-billing","previous_response_id":"azure_1","input":"second"}`,
	} {
		require.NoError(t, f.client.WriteMessage(websocket.TextMessage, []byte(payload)))
		require.Equal(t, "response.completed", readResponsesHTTPWSTerminal(t, f.client)["type"])
	}
	first, second := <-versions, <-versions
	require.Equal(t, "2025-03-01-preview", first)
	assert.Equal(t, first, second, "subsequent HTTP requests must retain the channel API version")
}

func TestResponsesHTTPClientCancellationBeforeHeadersRefundsWithoutRetry(t *testing.T) {
	f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0.002))`)
	oldErrors, oldRetries := constant.ErrorLogEnabled, common.RetryTimes
	constant.ErrorLogEnabled, common.RetryTimes = true, 2
	t.Cleanup(func() { constant.ErrorLogEnabled, common.RetryTimes = oldErrors, oldRetries })
	started, upstreamCancelled := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		if calls.Add(1) == 1 {
			close(started)
		}
		<-r.Context().Done()
		close(upstreamCancelled)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, f.gatewayURL+"/v1/responses", strings.NewReader(`{"model":"ws-billing","input":"hello","stream":true}`))
	require.NoError(t, err)
	request.Header.Set("Authorization", "Bearer sk-"+f.token.Key)
	request.Header.Set("Content-Type", "application/json")
	finished := make(chan error, 1)
	go func() {
		response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
		if response != nil {
			_ = response.Body.Close()
		}
		finished <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream request did not start")
	}
	cancel()
	require.ErrorIs(t, <-finished, context.Canceled)
	select {
	case <-f.httpDone:
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled relay did not finish")
	}
	select {
	case <-upstreamCancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream was not cancelled")
	}
	assert.Equal(t, int32(1), calls.Load())
	var logs []model.Log
	require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Equal(t, model.LogTypeError, logs[0].Type)
	assert.Contains(t, logs[0].Content, "status_code=499")
	assert.Contains(t, logs[0].Content, "request canceled before upstream response")
	assert.NotContains(t, logs[0].Content, "upstream error: do request failed")
	require.Eventually(t, func() bool {
		require.NoError(t, model.DB.First(f.token, f.token.Id).Error)
		return f.token.RemainQuota == 3000
	}, 3*time.Second, 10*time.Millisecond, "pre-consumed token quota must be refunded")
	require.NoError(t, model.DB.First(f.user, f.user.Id).Error)
	assert.Equal(t, 100000, f.user.Quota)
	require.NoError(t, model.DB.First(f.channel, f.channel.Id).Error)
	assert.Equal(t, common.ChannelStatusEnabled, f.channel.Status)
}
