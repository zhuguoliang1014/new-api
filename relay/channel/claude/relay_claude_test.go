package claude

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type emptyStreamBilling struct {
	relaycommon.BillingSettler
	reserved int
	settled  []int
}

func (b *emptyStreamBilling) GetPreConsumedQuota() int { return b.reserved }

func (b *emptyStreamBilling) Settle(quota int) error {
	b.settled = append(b.settled, quota)
	return nil
}

func TestEmptyStreamSettlementReleasesReservation(t *testing.T) {
	for _, reserved := range []int{0, 50000} {
		for _, estimated := range []bool{false, true} {
			t.Run(fmt.Sprintf("reserved=%d/estimated_snapshot=%t", reserved, estimated), func(t *testing.T) {
				c, _ := gin.CreateTestContext(httptest.NewRecorder())
				c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
				common.SetContextKey(c, constant.ContextKeyLocalCountTokens, true)
				billing := &emptyStreamBilling{reserved: reserved}
				info := &relaycommon.RelayInfo{
					IsStream:     true,
					StreamStatus: relaycommon.NewStreamStatus(),
					Billing:      billing,
				}
				info.StreamStatus.SetEndReason(relaycommon.StreamEndReasonClientGone, context.Canceled)
				usage := &dto.Usage{PromptTokens: 3580477, TotalTokens: 3580477}
				if estimated {
					usage.BillingUsage = dto.NewClaudeMessagesBillingUsage(&dto.ClaudeUsage{InputTokens: 3580477})
					usage.BillingUsage.Estimated = true
				}
				service.PostTextConsumeQuota(c, info, usage, nil)
				assert.Equal(t, []int{0}, billing.settled, "settling at zero releases wallet/subscription and token reservations")
			})
		}
	}
}

func TestClaudeStreamHandlerRequiresUpstreamUsageOrContent(t *testing.T) {
	oldTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = oldTimeout })

	tests := []struct {
		name       string
		body       string
		cancelled  bool
		wantError  bool
		wantPrompt int
	}{
		{name: "empty EOF", wantError: true},
		{name: "client disconnected before first event", cancelled: true, wantError: true},
		{name: "heartbeat only", body: "data: {\"type\":\"ping\"}\n\n", wantError: true},
		{name: "message start without usage", body: "data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"model\":\"claude-test\"}}\n\n", wantError: true},
		{name: "empty text block", body: "data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n", wantError: true},
		{name: "terminal without content or usage", body: "data: {\"type\":\"message_stop\"}\n\n", wantError: true},
		{name: "real input usage without output", body: "data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-test\",\"usage\":{\"input_tokens\":100,\"output_tokens\":0}}}\n\n", wantPrompt: 100},
		{name: "real cache usage without output", body: "data: {\"type\":\"message_start\",\"message\":{\"model\":\"claude-test\",\"usage\":{\"input_tokens\":1,\"cache_read_input_tokens\":200}}}\n\n", wantPrompt: 1},
		{name: "partial text without usage", body: "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\n", wantPrompt: 3580477},
		{name: "partial thinking without usage", body: "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"thinking\"}}\n\n", wantPrompt: 3580477},
		{name: "tool use without usage", body: "data: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"tool_use\",\"id\":\"tool_1\",\"name\":\"lookup\",\"input\":{}}}\n\n", wantPrompt: 3580477},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/messages", nil)
			if tt.cancelled {
				ctx, cancel := context.WithCancel(c.Request.Context())
				cancel()
				c.Request = c.Request.WithContext(ctx)
			}
			info := &relaycommon.RelayInfo{
				RelayFormat: types.RelayFormatClaude,
				ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "claude-test"},
			}
			info.SetEstimatePromptTokens(3580477)
			usage, apiErr := ClaudeStreamHandler(c, &http.Response{Body: io.NopCloser(strings.NewReader(tt.body))}, info)
			if tt.wantError {
				require.NotNil(t, apiErr)
				assert.Equal(t, types.ErrorCodeEmptyResponse, apiErr.GetErrorCode())
				assert.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
				assert.Nil(t, usage, "empty failed streams must not produce estimated billable usage")
				return
			}
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, tt.wantPrompt, usage.PromptTokens)
			require.NotNil(t, usage.BillingUsage)
		})
	}
}

func commonPointer[T any](value T) *T {
	return &value
}

func TestResponseOpenAI2ClaudeToolUseInputIsObject(t *testing.T) {
	tests := []struct {
		name string
		args string
		want map[string]any
	}{
		{name: "object", args: `{"q":"x"}`, want: map[string]any{"q": "x"}},
		{name: "empty", args: "", want: map[string]any{}},
		{name: "invalid", args: "{", want: map[string]any{}},
		{name: "null", args: "null", want: map[string]any{}},
		{name: "array", args: `["x"]`, want: map[string]any{}},
		{name: "string", args: `"x"`, want: map[string]any{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg := dto.Message{Role: "assistant"}
			msg.SetToolCalls([]dto.ToolCallRequest{
				{
					ID:   "call_1",
					Type: "function",
					Function: dto.FunctionRequest{
						Name:      "lookup",
						Arguments: tt.args,
					},
				},
			})
			resp := relayconvert.ResponseOpenAI2Claude(&dto.OpenAITextResponse{
				Id:    "chatcmpl_1",
				Model: "gpt-test",
				Choices: []dto.OpenAITextResponseChoice{
					{Message: msg, FinishReason: "tool_calls"},
				},
			}, nil)

			require.Len(t, resp.Content, 1)
			assert.Equal(t, "tool_use", resp.Content[0].Type)
			assert.Equal(t, tt.want, resp.Content[0].Input)
		})
	}
}

func TestFormatClaudeResponseInfo_MessageStart(t *testing.T) {
	claudeInfo := &ClaudeResponseInfo{
		Usage: &dto.Usage{},
	}
	claudeResponse := &dto.ClaudeResponse{
		Type: "message_start",
		Message: &dto.ClaudeMediaMessage{
			Id:    "msg_123",
			Model: "claude-3-5-sonnet",
			Usage: &dto.ClaudeUsage{
				InputTokens:              100,
				OutputTokens:             1,
				CacheCreationInputTokens: 50,
				CacheReadInputTokens:     30,
			},
		},
	}

	ok := FormatClaudeResponseInfo(claudeResponse, nil, claudeInfo)
	if !ok {
		t.Fatal("expected true")
	}
	if claudeInfo.Usage.PromptTokens != 100 {
		t.Errorf("PromptTokens = %d, want 100", claudeInfo.Usage.PromptTokens)
	}
	if claudeInfo.Usage.PromptTokensDetails.CachedTokens != 30 {
		t.Errorf("CachedTokens = %d, want 30", claudeInfo.Usage.PromptTokensDetails.CachedTokens)
	}
	if claudeInfo.Usage.PromptTokensDetails.CachedCreationTokens != 50 {
		t.Errorf("CachedCreationTokens = %d, want 50", claudeInfo.Usage.PromptTokensDetails.CachedCreationTokens)
	}
	if claudeInfo.ResponseId != "msg_123" {
		t.Errorf("ResponseId = %s, want msg_123", claudeInfo.ResponseId)
	}
	if claudeInfo.Model != "claude-3-5-sonnet" {
		t.Errorf("Model = %s, want claude-3-5-sonnet", claudeInfo.Model)
	}
}

func TestFormatClaudeResponseInfo_MessageDelta_FullUsage(t *testing.T) {
	// message_start 先积累 usage
	claudeInfo := &ClaudeResponseInfo{
		Usage: &dto.Usage{
			PromptTokens: 100,
			PromptTokensDetails: dto.InputTokenDetails{
				CachedTokens:         30,
				CachedCreationTokens: 50,
			},
			CompletionTokens: 1,
		},
	}

	// message_delta 带完整 usage（原生 Anthropic 场景）
	claudeResponse := &dto.ClaudeResponse{
		Type: "message_delta",
		Usage: &dto.ClaudeUsage{
			InputTokens:              100,
			OutputTokens:             200,
			CacheCreationInputTokens: 50,
			CacheReadInputTokens:     30,
		},
	}

	ok := FormatClaudeResponseInfo(claudeResponse, nil, claudeInfo)
	if !ok {
		t.Fatal("expected true")
	}
	if claudeInfo.Usage.PromptTokens != 100 {
		t.Errorf("PromptTokens = %d, want 100", claudeInfo.Usage.PromptTokens)
	}
	if claudeInfo.Usage.CompletionTokens != 200 {
		t.Errorf("CompletionTokens = %d, want 200", claudeInfo.Usage.CompletionTokens)
	}
	if claudeInfo.Usage.TotalTokens != 300 {
		t.Errorf("TotalTokens = %d, want 300", claudeInfo.Usage.TotalTokens)
	}
	if !claudeInfo.Done {
		t.Error("expected Done = true")
	}
}

func TestFormatClaudeResponseInfo_MessageDelta_OnlyOutputTokens(t *testing.T) {
	// 模拟 Bedrock: message_start 已积累 usage
	claudeInfo := &ClaudeResponseInfo{
		Usage: &dto.Usage{
			PromptTokens: 100,
			PromptTokensDetails: dto.InputTokenDetails{
				CachedTokens:         30,
				CachedCreationTokens: 50,
			},
			CompletionTokens:            1,
			ClaudeCacheCreation5mTokens: 10,
			ClaudeCacheCreation1hTokens: 20,
		},
	}

	// Bedrock 的 message_delta 只有 output_tokens，缺少 input_tokens 和 cache 字段
	claudeResponse := &dto.ClaudeResponse{
		Type: "message_delta",
		Usage: &dto.ClaudeUsage{
			OutputTokens: 200,
			// InputTokens, CacheCreationInputTokens, CacheReadInputTokens 都是 0
		},
	}

	ok := FormatClaudeResponseInfo(claudeResponse, nil, claudeInfo)
	if !ok {
		t.Fatal("expected true")
	}
	// PromptTokens 应保持 message_start 的值（因为 message_delta 的 InputTokens=0，不更新）
	if claudeInfo.Usage.PromptTokens != 100 {
		t.Errorf("PromptTokens = %d, want 100", claudeInfo.Usage.PromptTokens)
	}
	if claudeInfo.Usage.CompletionTokens != 200 {
		t.Errorf("CompletionTokens = %d, want 200", claudeInfo.Usage.CompletionTokens)
	}
	if claudeInfo.Usage.TotalTokens != 300 {
		t.Errorf("TotalTokens = %d, want 300", claudeInfo.Usage.TotalTokens)
	}
	// cache 字段应保持 message_start 的值
	if claudeInfo.Usage.PromptTokensDetails.CachedTokens != 30 {
		t.Errorf("CachedTokens = %d, want 30", claudeInfo.Usage.PromptTokensDetails.CachedTokens)
	}
	if claudeInfo.Usage.PromptTokensDetails.CachedCreationTokens != 50 {
		t.Errorf("CachedCreationTokens = %d, want 50", claudeInfo.Usage.PromptTokensDetails.CachedCreationTokens)
	}
	if claudeInfo.Usage.ClaudeCacheCreation5mTokens != 10 {
		t.Errorf("ClaudeCacheCreation5mTokens = %d, want 10", claudeInfo.Usage.ClaudeCacheCreation5mTokens)
	}
	if claudeInfo.Usage.ClaudeCacheCreation1hTokens != 20 {
		t.Errorf("ClaudeCacheCreation1hTokens = %d, want 20", claudeInfo.Usage.ClaudeCacheCreation1hTokens)
	}
	if !claudeInfo.Done {
		t.Error("expected Done = true")
	}
}

func TestFormatClaudeResponseInfo_NilClaudeInfo(t *testing.T) {
	claudeResponse := &dto.ClaudeResponse{Type: "message_start"}
	ok := FormatClaudeResponseInfo(claudeResponse, nil, nil)
	if ok {
		t.Error("expected false for nil claudeInfo")
	}
}

func TestFormatClaudeResponseInfo_ContentBlockDelta(t *testing.T) {
	text := "hello"
	claudeInfo := &ClaudeResponseInfo{
		Usage:        &dto.Usage{},
		ResponseText: strings.Builder{},
	}
	claudeResponse := &dto.ClaudeResponse{
		Type: "content_block_delta",
		Delta: &dto.ClaudeMediaMessage{
			Text: &text,
		},
	}

	ok := FormatClaudeResponseInfo(claudeResponse, nil, claudeInfo)
	if !ok {
		t.Fatal("expected true")
	}
	if claudeInfo.ResponseText.String() != "hello" {
		t.Errorf("ResponseText = %q, want %q", claudeInfo.ResponseText.String(), "hello")
	}
}

func TestBuildOpenAIStyleUsageFromClaudeUsage(t *testing.T) {
	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 20,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:         30,
			CachedCreationTokens: 50,
		},
		ClaudeCacheCreation5mTokens: 10,
		ClaudeCacheCreation1hTokens: 20,
		UsageSemantic:               "anthropic",
	}

	openAIUsage := buildOpenAIStyleUsageFromClaudeUsage(usage)

	if openAIUsage.PromptTokens != 180 {
		t.Fatalf("PromptTokens = %d, want 180", openAIUsage.PromptTokens)
	}
	if openAIUsage.InputTokens != 180 {
		t.Fatalf("InputTokens = %d, want 180", openAIUsage.InputTokens)
	}
	if openAIUsage.TotalTokens != 200 {
		t.Fatalf("TotalTokens = %d, want 200", openAIUsage.TotalTokens)
	}
	if openAIUsage.UsageSemantic != "openai" {
		t.Fatalf("UsageSemantic = %s, want openai", openAIUsage.UsageSemantic)
	}
	if openAIUsage.UsageSource != "anthropic" {
		t.Fatalf("UsageSource = %s, want anthropic", openAIUsage.UsageSource)
	}
}

func TestBuildOpenAIStyleUsageFromClaudeUsagePreservesCacheCreationRemainder(t *testing.T) {
	tests := []struct {
		name                    string
		cachedCreationTokens    int
		cacheCreationTokens5m   int
		cacheCreationTokens1h   int
		expectedTotalInputToken int
	}{
		{
			name:                    "prefers aggregate when it includes remainder",
			cachedCreationTokens:    50,
			cacheCreationTokens5m:   10,
			cacheCreationTokens1h:   20,
			expectedTotalInputToken: 180,
		},
		{
			name:                    "falls back to split tokens when aggregate missing",
			cachedCreationTokens:    0,
			cacheCreationTokens5m:   10,
			cacheCreationTokens1h:   20,
			expectedTotalInputToken: 160,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			usage := &dto.Usage{
				PromptTokens:     100,
				CompletionTokens: 20,
				PromptTokensDetails: dto.InputTokenDetails{
					CachedTokens:         30,
					CachedCreationTokens: tt.cachedCreationTokens,
				},
				ClaudeCacheCreation5mTokens: tt.cacheCreationTokens5m,
				ClaudeCacheCreation1hTokens: tt.cacheCreationTokens1h,
				UsageSemantic:               "anthropic",
			}

			openAIUsage := buildOpenAIStyleUsageFromClaudeUsage(usage)

			if openAIUsage.PromptTokens != tt.expectedTotalInputToken {
				t.Fatalf("PromptTokens = %d, want %d", openAIUsage.PromptTokens, tt.expectedTotalInputToken)
			}
			if openAIUsage.InputTokens != tt.expectedTotalInputToken {
				t.Fatalf("InputTokens = %d, want %d", openAIUsage.InputTokens, tt.expectedTotalInputToken)
			}
		})
	}
}

func TestBuildOpenAIStyleUsageFromClaudeUsageDefaultsAggregateCacheCreationTo5m(t *testing.T) {
	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 20,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens:         30,
			CachedCreationTokens: 50,
		},
		UsageSemantic: "anthropic",
	}

	openAIUsage := buildOpenAIStyleUsageFromClaudeUsage(usage)

	require.Equal(t, 50, openAIUsage.ClaudeCacheCreation5mTokens)
	require.Equal(t, 0, openAIUsage.ClaudeCacheCreation1hTokens)
}

func applyOpenAIChatReasoningThroughHandlerOrder(t *testing.T, original dto.GeneralOpenAIRequest) (*dto.GeneralOpenAIRequest, *relaycommon.RelayInfo) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	info := &relaycommon.RelayInfo{
		OriginModelName: original.Model,
		Request:         &original,
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: original.Model,
		},
	}
	outbound, err := common.DeepCopy(&original)
	require.NoError(t, err)
	require.NoError(t, helper.ModelMappedHelper(c, info, outbound))
	err = helper.ApplyReasoningModelSuffix(nil, info, outbound)
	require.NoError(t, err)
	return outbound, info
}

func TestOpenAIChatRequestToClaudeMessages_ClaudeOpus48HighUsesAdaptiveThinking(t *testing.T) {
	original := dto.GeneralOpenAIRequest{
		Model:       "claude-opus-4-8-high",
		Temperature: commonPointer(0.7),
		TopP:        commonPointer(0.9),
		TopK:        commonPointer(40),
		Messages: []dto.Message{
			{
				Role:    "user",
				Content: "hello",
			},
		},
	}

	outbound, info := applyOpenAIChatReasoningThroughHandlerOrder(t, original)
	claudeRequest, err := relayconvert.OpenAIChatRequestToClaudeMessages(nil, info, *outbound)
	require.NoError(t, err)
	require.Equal(t, "claude-opus-4-8", claudeRequest.Model)
	require.NotNil(t, claudeRequest.Thinking)
	require.Equal(t, "adaptive", claudeRequest.Thinking.Type)
	require.Equal(t, "summarized", claudeRequest.Thinking.Display)
	require.JSONEq(t, `{"effort":"high"}`, string(claudeRequest.OutputConfig))
	require.Nil(t, claudeRequest.Temperature)
	require.Nil(t, claudeRequest.TopP)
	require.Nil(t, claudeRequest.TopK)
}

func TestOpenAIChatRequestToClaudeMessages_ClaudeOpus48ThinkingUsesAdaptiveHighEffort(t *testing.T) {
	original := dto.GeneralOpenAIRequest{
		Model:       "claude-opus-4-8-thinking",
		Temperature: commonPointer(0.7),
		TopP:        commonPointer(0.9),
		TopK:        commonPointer(40),
		Messages: []dto.Message{
			{
				Role:    "user",
				Content: "hello",
			},
		},
	}

	outbound, info := applyOpenAIChatReasoningThroughHandlerOrder(t, original)
	claudeRequest, err := relayconvert.OpenAIChatRequestToClaudeMessages(nil, info, *outbound)
	require.NoError(t, err)
	require.Equal(t, "claude-opus-4-8", claudeRequest.Model)
	require.NotNil(t, claudeRequest.Thinking)
	require.Equal(t, "adaptive", claudeRequest.Thinking.Type)
	require.Equal(t, "summarized", claudeRequest.Thinking.Display)
	require.JSONEq(t, `{"effort":"high"}`, string(claudeRequest.OutputConfig))
	require.Nil(t, claudeRequest.Temperature)
	require.Nil(t, claudeRequest.TopP)
	require.Nil(t, claudeRequest.TopK)
}
