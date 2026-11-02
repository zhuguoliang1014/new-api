package controller

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/model_setting"
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
