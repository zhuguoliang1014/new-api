package controller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Opt-in protocol interoperability test. The real CLI receives canned local
// Responses events; it cannot contact a paid model or load the user's config.
func TestResponsesHTTPWebSocketCodexProviderFlag(t *testing.T) {
	binary := os.Getenv("TEST_CODEX_BINARY")
	if binary == "" {
		t.Skip("set TEST_CODEX_BINARY to run local Codex transport interoperability")
	}
	for _, mode := range []string{"websocket", "http", "fallback"} {
		t.Run(mode, func(t *testing.T) {
			f := newResponsesHTTPWSFixture(t, `tier("request", fixed(0))`)
			var calls atomic.Int32
			f.httpUpstream = func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "text/event-stream")
				item := map[string]any{"id": "msg_bridge", "type": "message", "role": "assistant", "status": "completed", "content": []any{map[string]any{"type": "output_text", "text": "BRIDGE_OK", "annotations": []any{}}}}
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.created", "response": map[string]any{"id": "resp_cli", "object": "response", "status": "in_progress", "model": "gpt-4o", "output": []any{}}})
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.output_item.added", "output_index": 0, "item": item})
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.output_text.delta", "item_id": "msg_bridge", "output_index": 0, "content_index": 0, "delta": "BRIDGE_OK"})
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.output_item.done", "output_index": 0, "item": item})
				writeResponsesHTTPWSEvent(t, w, map[string]any{"type": "response.completed", "response": map[string]any{"id": "resp_cli", "object": "response", "status": "completed", "model": "gpt-4o", "output": []any{item}, "usage": map[string]any{"input_tokens": 1000, "output_tokens": 10, "total_tokens": 1010}}})
			}
			baseURL := f.gatewayURL
			var rejected atomic.Int32
			if mode == "fallback" {
				target, err := url.Parse(baseURL)
				require.NoError(t, err)
				proxy := httputil.NewSingleHostReverseProxy(target)
				endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Method == http.MethodGet && r.URL.Path == "/v1/responses" {
						rejected.Add(1)
						http.Error(w, "WebSocket transport unavailable", http.StatusUpgradeRequired)
						return
					}
					proxy.ServeHTTP(w, r)
				}))
				defer endpoint.Close()
				baseURL = endpoint.URL
			}
			provider := fmt.Sprintf(`model_providers.bridge_test={name="Bridge test",base_url=%q,env_key="NEWAPI_WS_TEST_KEY",wire_api="responses",supports_websockets=%t,request_max_retries=0,stream_max_retries=0}`, baseURL+"/v1", mode != "http")
			ctx, cancel := context.WithTimeout(t.Context(), 25*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, binary, "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "--json", "-C", t.TempDir(), "-c", `model_provider="bridge_test"`, "-c", `model="ws-billing"`, "-c", provider, "-c", "features.apps=false", "Protocol test. Reply exactly BRIDGE_OK. Do not use tools.")
			cmd.Env = append(os.Environ(), "NEWAPI_WS_TEST_KEY=sk-"+f.token.Key)
			output, err := cmd.CombinedOutput()
			require.NoError(t, err, "local client output: %s", output)
			assert.Contains(t, string(output), "BRIDGE_OK")
			assert.Equal(t, int32(1), calls.Load(), "one generated turn, no paid upstream")
			var logs []model.Log
			require.NoError(t, model.LOG_DB.Where("token_id = ?", f.token.Id).Find(&logs).Error)
			require.Len(t, logs, 1)
			var other struct {
				Admin struct {
					Transport string `json:"downstream_transport"`
				} `json:"admin_info"`
			}
			require.NoError(t, common.UnmarshalJsonStr(logs[0].Other, &other))
			if mode == "websocket" {
				assert.Equal(t, "websocket", other.Admin.Transport)
			} else {
				assert.Empty(t, other.Admin.Transport)
			}
			if mode == "fallback" {
				assert.Positive(t, rejected.Load())
			}
			// Only synthetic output is logged. The configured API token is never saved.
			assert.NotContains(t, string(output), f.token.Key)
			t.Logf("mode=%s model_requests=%d websocket_rejections=%d transport=%s", mode, calls.Load(), rejected.Load(), strings.TrimSpace(other.Admin.Transport))
		})
	}
}
