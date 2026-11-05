package relay

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	appconstant "github.com/QuantumNous/new-api/constant"
	appdto "github.com/QuantumNous/new-api/dto"
	appmodel "github.com/QuantumNous/new-api/model"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const (
	responsesWSHTTPContextBytes = 32 << 20
	responsesWSHTTPGlobalBytes  = 256 << 20
	responsesWSHTTPHistorySlots = 33 // Latest response for each of 32 named lanes and the default lane.
)

var responsesWSHTTPMemory atomic.Int64

// Histories belong to one physical downstream connection. They are never
// indexed globally by an upstream response ID, and are released on disconnect.
// Only the serial request worker touches histories or changes their ownership.
type responsesWSHTTPState struct {
	userID, tokenID int
	bytes           int64
	history         []responsesWSHTTPHistory
}

type responsesWSHTTPHistory struct {
	id, streamID, model string
	items               []common.RawMessage
	size                int64
}

func (h *responsesWSHTTPState) clear() {
	responsesWSHTTPMemory.Add(-h.bytes)
	h.bytes = 0
	h.history = nil
}

func (h *responsesWSHTTPState) remember(id, streamID, model string, items []common.RawMessage) bool {
	// Budget the snapshot header and retained identifiers as well as input.
	// Empty-input warmups still retain metadata and must consume the budget.
	size := int64(80 + len(id) + len(streamID) + len(model))
	for _, item := range items {
		// Include slice-header overhead rather than budgeting only payload
		// bytes for a history containing many small tool/message items.
		size += int64(len(item)) + 24
	}
	if id == "" || len(id) > responsesWSMaxIdentifierBytes || len(model) > responsesWSMaxIdentifierBytes || len(streamID) > 256 || size > responsesWSHTTPContextBytes {
		return false
	}
	// Drop superseded lane state before reserving the new snapshot. Branches
	// already retain their own immutable prefix, so advancing a lane is safe.
	for i := len(h.history) - 1; i >= 0; i-- {
		if h.history[i].streamID == streamID || h.history[i].id == id {
			h.bytes -= h.history[i].size
			responsesWSHTTPMemory.Add(-h.history[i].size)
			h.history = slices.Delete(h.history, i, i+1)
		}
	}
	for len(h.history) > 0 && (len(h.history) >= responsesWSHTTPHistorySlots || h.bytes+size > responsesWSHTTPContextBytes) {
		h.bytes -= h.history[0].size
		responsesWSHTTPMemory.Add(-h.history[0].size)
		h.history = slices.Delete(h.history, 0, 1)
	}
	for {
		total := responsesWSHTTPMemory.Load()
		if total+size > responsesWSHTTPGlobalBytes {
			return false
		}
		if responsesWSHTTPMemory.CompareAndSwap(total, total+size) {
			break
		}
	}
	// Own the slice at its logical length; spare capacity in the caller's
	// expansion must not retain unbudgeted item headers. Item bytes are immutable.
	snapshot := make([]common.RawMessage, len(items))
	copy(snapshot, items)
	h.history = append(h.history, responsesWSHTTPHistory{id: strings.Clone(id), streamID: strings.Clone(streamID), model: strings.Clone(model), items: snapshot, size: size})
	h.bytes += size
	return true
}

func (h *responsesWSHTTPState) expand(create responsesWSCreateRequest) (responsesWSCreateRequest, []common.RawMessage, *types.NewAPIError) {
	var raw map[string]common.RawMessage
	if err := common.Unmarshal(create.Body, &raw); err != nil {
		return create, nil, newResponsesWSInvalidRequestError(err)
	}
	if value := bytes.TrimSpace(raw["conversation"]); len(value) > 0 && !bytes.Equal(value, []byte("null")) {
		return create, nil, newResponsesWSInvalidRequestError(errors.New("conversation is not supported by the WebSocket HTTP bridge; send input and previous_response_id"))
	}
	var items []common.RawMessage
	if parent := create.Request.PreviousResponseID; parent != "" {
		index := slices.IndexFunc(h.history, func(v responsesWSHTTPHistory) bool { return v.id == parent && v.model == create.Request.Model })
		if index < 0 {
			return create, nil, types.WithOpenAIError(types.OpenAIError{Type: "invalid_request_error", Code: "previous_response_not_found", Param: "previous_response_id", Message: "Previous response is not available on this connection; resend the full input with previous_response_id omitted."}, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		items = append(items, h.history[index].items...)
	}
	input := bytes.TrimSpace(raw["input"])
	switch {
	case len(input) == 0 || bytes.Equal(input, []byte("null")):
	case input[0] == '"':
		var text string
		if err := common.Unmarshal(input, &text); err != nil {
			return create, nil, newResponsesWSInvalidRequestError(err)
		}
		item, err := common.Marshal(map[string]any{"type": "message", "role": "user", "content": text})
		if err != nil {
			return create, nil, newResponsesWSInvalidRequestError(err)
		}
		items = append(items, item)
	case input[0] == '[':
		var incoming []common.RawMessage
		if err := common.Unmarshal(input, &incoming); err != nil {
			return create, nil, newResponsesWSInvalidRequestError(err)
		}
		for _, item := range incoming {
			trimmed := bytes.TrimSpace(item)
			if len(trimmed) == 0 || trimmed[0] != '{' {
				return create, nil, newResponsesWSInvalidRequestError(errors.New("input items must be objects"))
			}
			var reference struct {
				Type string `json:"type"`
			}
			if err := common.Unmarshal(item, &reference); err != nil {
				return create, nil, newResponsesWSInvalidRequestError(err)
			}
			if reference.Type == "item_reference" {
				return create, nil, newResponsesWSInvalidRequestError(errors.New("item_reference is not supported by the WebSocket HTTP bridge; send the full item"))
			}
		}
		items = append(items, incoming...)
	default:
		return create, nil, newResponsesWSInvalidRequestError(errors.New("input must be a string or an array of items"))
	}
	if items == nil {
		items = []common.RawMessage{}
	}
	fullInput, err := common.Marshal(items)
	if err != nil {
		return create, nil, newResponsesWSInvalidRequestError(err)
	}
	raw["input"] = fullInput
	raw["stream"] = common.RawMessage("true")
	delete(raw, "previous_response_id")
	// Reasoning items need their encrypted content when replayed over stateless
	// HTTP, including when the client's store=false response cannot be fetched.
	var include []string
	if value := raw["include"]; len(value) > 0 && !bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
		if err := common.Unmarshal(value, &include); err != nil {
			return create, nil, newResponsesWSInvalidRequestError(errors.New("include must be an array of strings"))
		}
	}
	if !slices.Contains(include, "reasoning.encrypted_content") {
		include = append(include, "reasoning.encrypted_content")
	}
	raw["include"], err = common.Marshal(include)
	if err != nil {
		return create, nil, newResponsesWSInvalidRequestError(err)
	}
	payload, err := common.Marshal(raw)
	if err != nil {
		return create, nil, newResponsesWSInvalidRequestError(err)
	}
	limit := appconstant.MaxRequestBodyMB
	if limit <= 0 {
		limit = 128
	}
	if int64(len(payload)) > int64(limit)<<20 {
		return create, nil, types.NewErrorWithStatusCode(common.ErrRequestBodyTooLarge, types.ErrorCodeReadRequestBodyFailed, http.StatusRequestEntityTooLarge, types.ErrOptionWithSkipRetry())
	}
	create.Request = dto.OpenAIResponsesRequest{}
	if err := common.Unmarshal(payload, &create.Request); err != nil {
		return create, nil, newResponsesWSInvalidRequestError(err)
	}
	create.Body = payload
	return create, items, nil
}

func (s *responsesWSSession) rememberConnectionContext(c *gin.Context, channel *appmodel.Channel, info *relaycommon.RelayInfo, model string) {
	s.lockedModel, s.lockedChannelID, s.lockedGroup = model, channel.Id, info.UsingGroup
	s.lockedKey, s.lockedKeyIndex = info.ApiKey, info.ChannelMultiKeyIndex
	s.lockedRoute, _ = channel.GetOtherSettings().AdvancedCustom.MatchPathForModel(c.Request.URL.Path, model)
	s.lockedContext = make(map[appconstant.ContextKey]any)
	for _, key := range []appconstant.ContextKey{
		appconstant.ContextKeyChannelId, appconstant.ContextKeyChannelName, appconstant.ContextKeyChannelType,
		appconstant.ContextKeyChannelCreateTime, appconstant.ContextKeyChannelSetting, appconstant.ContextKeyChannelOtherSetting,
		appconstant.ContextKeyChannelParamOverride, appconstant.ContextKeyChannelHeaderOverride, appconstant.ContextKeyChannelOrganization,
		appconstant.ContextKeyChannelAutoBan, appconstant.ContextKeyChannelModelMapping, appconstant.ContextKeyChannelStatusCodeMapping,
		appconstant.ContextKeyChannelIsMultiKey, appconstant.ContextKeyChannelMultiKeyIndex, appconstant.ContextKeyChannelKey, appconstant.ContextKeyChannelBaseUrl,
		appconstant.ContextKeyUpstreamRequestOrigin,
	} {
		if value, ok := c.Get(string(key)); ok {
			s.lockedContext[key] = value
		}
	}
	s.registerChannelClose(channel.Id)
}

func (s *responsesWSSession) runHTTPCall(c *gin.Context, state *responsesWSCallState, create responsesWSCreateRequest) (apiErr *types.NewAPIError) {
	userID := common.GetContextKeyInt(c, appconstant.ContextKeyUserId)
	tokenID := common.GetContextKeyInt(c, appconstant.ContextKeyTokenId)
	cache := s.httpBridge
	if cache.userID != 0 && (cache.userID != userID || cache.tokenID != tokenID) {
		return types.NewErrorWithStatusCode(errors.New("connection identity changed; reconnect required"), types.ErrorCodeAccessDenied, http.StatusForbidden, types.ErrOptionWithSkipRetry())
	}
	cache.userID, cache.tokenID = userID, tokenID
	common.SetContextKey(c, appconstant.ContextKeyRequestStartTime, time.Now())
	model := create.Request.Model
	if model == "" {
		return newResponsesWSInvalidRequestError(errors.New("model is required"))
	}
	if s.lockedModel != "" && model != s.lockedModel {
		return newResponsesWSInvalidRequestError(errors.New("connection model changed; reconnect required"))
	}
	if apiErr = checkResponsesWSModelAccess(c, model); apiErr != nil {
		return apiErr
	}
	var generate = true
	if len(create.Generate) > 0 {
		if bytes.Equal(bytes.TrimSpace(create.Generate), []byte("null")) || common.Unmarshal(create.Generate, &generate) != nil {
			return newResponsesWSInvalidRequestError(errors.New("generate must be a boolean"))
		}
	}
	create, items, apiErr := cache.expand(create)
	if apiErr != nil {
		return apiErr
	}
	common.CleanupBodyStorage(c)
	c.Set(common.KeyRequestBody, nil)
	c.Request.Body = io.NopCloser(bytes.NewReader(create.Body))
	c.Request.ContentLength = int64(len(create.Body))
	c.Request.Method = http.MethodPost
	// generate:false is local preparation, not an upstream session. Binding
	// here would choose a route before the real request supplies its cache key
	// and would skip the corresponding session-header override template.
	if !generate {
		return s.warmHTTPContext(state, create, items)
	}
	common.SetContextKey(c, appconstant.ContextKeyOriginalModel, model)
	constraints := service.GetChannelConstraints(c)
	constraints.AddFilter(appdto.ChannelFilter{Kind: appdto.FilterRequestPath, RequestPath: c.Request.URL.Path})
	var channel *appmodel.Channel
	if s.lockedChannelID != 0 {
		if apiErr = s.restoreConnectionContext(c, model); apiErr != nil {
			return apiErr
		}
		service.AppendUsedChannel(c, s.lockedChannelID)
	} else {
		channel, apiErr = selectResponsesTransportChannel(c, model, &service.RetryParam{Ctx: c, TokenGroup: common.GetContextKeyString(c, appconstant.ContextKeyUsingGroup), ModelName: model, RequestPath: c.Request.URL.Path, Retry: common.GetPointer(0)}, appdto.FilterResponsesHTTP)
		if apiErr != nil {
			return apiErr
		}
		service.AppendUsedChannel(c, channel.Id)
		service.RequestPolicy(c).BeginAttempt(channel, common.GetContextKeyString(c, appconstant.ContextKeyUsingGroup))
	}
	info := relaycommon.GenRelayInfoResponses(c, &create.Request)
	info.IsStream = true
	common.SetContextKey(c, appconstant.ContextKeyIsStream, true)
	info.InitChannelMeta(c)
	c.Set("responses_downstream_transport", "websocket")
	c.Set("responses_upstream_transport", "http")
	defer func() {
		if recovered := recover(); recovered != nil {
			apiErr = types.NewError(fmt.Errorf("responses websocket HTTP relay panic: %v", recovered), types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
			state.closeCode = websocket.CloseInternalServerErr
		}
		apiErr = RefundFailedRequestBilling(c, info, apiErr)
		perfmetrics.RecordRelayResult(c.Request.Context(), info, apiErr)
	}()
	if apiErr = PrepareRequestBilling(c, info); apiErr != nil {
		return apiErr
	}
	// Billing resolves an auto token to the group selected for this request.
	// Pin that concrete group so subsequent turns can recheck its permission.
	if channel != nil {
		s.rememberConnectionContext(c, channel, info, model)
	}
	requestCtx, cancel := context.WithCancel(c.Request.Context())
	defer cancel()
	c.Request = c.Request.WithContext(requestCtx)
	writer := &responsesWSHTTPWriter{ResponseWriter: c.Writer, session: s, state: state, streamID: create.StreamID}
	c.Writer = writer
	watchDone := make(chan struct{})
	watchExited := make(chan struct{})
	go func() {
		defer close(watchExited)
		for {
			select {
			case control := <-state.controls:
				shouldCancel, err := writer.applyControl(control)
				if err != nil {
					s.sendError(control.eventID, control.streamID, newResponsesWSInvalidRequestError(err))
					continue
				}
				if shouldCancel {
					cancel()
				}
			case <-watchDone:
				return
			case <-s.ctx.Done():
				cancel()
				return
			}
		}
	}()
	stopWatch := sync.OnceFunc(func() { close(watchDone); <-watchExited })
	defer stopWatch()
	// One application-level attempt only: after submission a missing response
	// is ambiguous, and switching transport could generate and charge twice.
	apiErr = ResponsesHelper(c, info)
	// The scanner and its writer have joined. Finish the control watcher before
	// reading its interrupt flag or publishing a terminal and its history.
	stopWatch()
	state.responseID = writer.responseID
	if writer.interrupted && writer.err == nil && apiErr == nil {
		// This is a downstream protocol completion only. ResponsesHelper already
		// settled the real upstream usage (or its ordinary missing-usage fallback).
		// Never feed synthetic usage back into billing or resubmit the generation.
		output := make([]common.RawMessage, 0, len(writer.completedItems))
		indexes := make([]int, 0, len(writer.completedItems))
		for index := range writer.completedItems {
			indexes = append(indexes, index)
		}
		slices.Sort(indexes)
		for _, index := range indexes {
			output = append(output, writer.completedItems[index])
		}
		response := map[string]any{"id": writer.responseID, "object": "response", "created_at": time.Now().Unix(), "model": model,
			"status": "incomplete", "output": output, "usage": writer.usage, "error": nil,
			"incomplete_details": map[string]string{"reason": "interrupted"}}
		event := map[string]any{"type": "response.incomplete", "response": response}
		if create.StreamID != "" {
			event["stream_id"] = create.StreamID
		}
		body, err := common.Marshal(event)
		if err != nil {
			return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
		state.terminal = &responsesWSMessage{kind: websocket.TextMessage, body: body}
		if !writer.outputOverflow {
			history := append(slices.Clone(items), output...)
			cache.remember(writer.responseID, create.StreamID, model, history)
		}
		return nil
	}
	if apiErr != nil {
		service.RecordPolicyFailure(c, info.ChannelId, apiErr, service.PolicyDecision{Action: "stop", Reason: "websocket_http_no_replay", Source: "transport"})
		service.ProcessChannelError(c, *types.NewChannelError(info.ChannelId, info.ChannelType, common.GetContextKeyString(c, appconstant.ContextKeyChannelName), info.ChannelIsMultiKey, info.ApiKey, common.GetContextKeyBool(c, appconstant.ContextKeyChannelAutoBan)), apiErr, info)
		return apiErr
	}
	if writer.err != nil {
		return types.NewError(writer.err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
	}
	if state.terminal == nil {
		code := "upstream_stream_incomplete"
		message := "Upstream stream ended without a terminal event; the request will not be replayed."
		if requestCtx.Err() != nil {
			code = "response_cancelled"
			message = "Response was cancelled."
		}
		return types.WithOpenAIError(types.OpenAIError{Type: "server_error", Code: code, Message: message}, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	if writer.completed && info.StreamStatus != nil && !info.StreamStatus.HasErrors() && info.StreamStatus.ResponseOutcome() == string(relaycommon.ResponseOutcomeCompleted) && writer.responseID != "" && writer.output != nil {
		history := make([]common.RawMessage, 0, len(items)+len(writer.output))
		history = append(history, items...)
		history = append(history, writer.output...)
		cache.remember(writer.responseID, create.StreamID, model, history)
		service.RecordChannelAffinity(c, info.ChannelId)
	}
	return nil
}

func (s *responsesWSSession) warmHTTPContext(state *responsesWSCallState, create responsesWSCreateRequest, items []common.RawMessage) *types.NewAPIError {
	id := "resp_newapi_" + common.NewRequestId()
	if !s.httpBridge.remember(id, create.StreamID, create.Request.Model, items) {
		return types.NewErrorWithStatusCode(errors.New("WebSocket context cache is full; retry with full input"), types.ErrorCodeBadResponse, http.StatusServiceUnavailable, types.ErrOptionWithSkipRetry())
	}
	response := map[string]any{"id": id, "object": "response", "created_at": time.Now().Unix(), "status": "completed", "model": create.Request.Model, "output": []any{}, "error": nil, "incomplete_details": nil, "usage": map[string]any{"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}}
	state.responseID = id
	for _, kind := range []string{"response.created", "response.completed"} {
		if kind == "response.created" {
			response["status"] = "in_progress"
		} else {
			response["status"] = "completed"
		}
		event := map[string]any{"type": kind, "response": response}
		if create.StreamID != "" {
			event["stream_id"] = create.StreamID
		}
		body, err := common.Marshal(event)
		if err != nil {
			return newResponsesWSInvalidRequestError(err)
		}
		if kind == "response.completed" {
			state.terminal = &responsesWSMessage{kind: websocket.TextMessage, body: body}
		} else if err = s.writeClient(websocket.TextMessage, body); err != nil {
			return types.NewError(err, types.ErrorCodeBadResponse, types.ErrOptionWithSkipRetry())
		}
	}
	return nil
}

// responsesWSHTTPWriter translates the normal SSE writer into WebSocket
// events. It never retains deltas: completed raw output items are retained for
// interruption, preserving reasoning ciphertext and vendor extension fields.
type responsesWSHTTPWriter struct {
	gin.ResponseWriter
	session        *responsesWSSession
	state          *responsesWSCallState
	streamID       string
	buffer         []byte
	err            error
	responseID     string
	completed      bool
	output         []common.RawMessage
	mu             sync.Mutex // Serializes interrupt acceptance with event delivery.
	terminal       bool
	interrupted    bool
	usage          common.RawMessage
	completedItems map[int]common.RawMessage
	outputBytes    int
	outputOverflow bool
}

func (w *responsesWSHTTPWriter) Write(data []byte) (int, error) {
	if w.err != nil {
		return 0, w.err
	}
	w.ResponseWriter.WriteHeader(http.StatusOK)
	if len(w.buffer)+len(data) > helper.DefaultMaxScannerBufferSize {
		w.err = errors.New("upstream SSE event exceeds the WebSocket frame limit")
		return 0, w.err
	}
	w.buffer = append(w.buffer, data...)
	for {
		end := bytes.IndexByte(w.buffer, '\n')
		if end < 0 {
			break
		}
		line := bytes.TrimSuffix(w.buffer[:end], []byte("\r"))
		// Copy before advancing: the parsed event's retained RawMessages must not
		// alias the reusable line buffer.
		if bytes.HasPrefix(line, []byte("data:")) {
			payload := bytes.TrimSpace(line[len("data:"):])
			if len(payload) > 0 && !bytes.Equal(payload, []byte("[DONE]")) {
				if err := w.event(payload); err != nil {
					w.err = err
					return 0, err
				}
			}
		}
		w.buffer = w.buffer[end+1:]
	}
	if len(w.buffer) == 0 {
		w.buffer = nil
	}
	return len(data), nil
}
func (w *responsesWSHTTPWriter) WriteString(data string) (int, error) { return w.Write([]byte(data)) }
func (w *responsesWSHTTPWriter) Flush()                               {}
func (w *responsesWSHTTPWriter) FlushError() error                    { return w.err }

func (w *responsesWSHTTPWriter) event(data []byte) error {
	var event map[string]common.RawMessage
	if err := common.Unmarshal(data, &event); err != nil {
		return errors.New("invalid upstream Responses event")
	}
	var kind string
	if err := common.Unmarshal(event["type"], &kind); err != nil {
		return errors.New("missing upstream Responses event type")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	// Events already buffered by the HTTP scanner still contribute to its usage
	// accumulator, but cannot deliver partial items after interrupt acceptance.
	if w.interrupted {
		return nil
	}
	if w.streamID != "" {
		event["stream_id"], _ = common.Marshal(w.streamID)
	} else {
		delete(event, "stream_id")
	}
	if kind == "error" && len(event["error"]) == 0 {
		// Responses SSE errors are flat; the WebSocket error envelope nests
		// the same fields under error, which clients use for fallback/recovery.
		var flat struct {
			Code    any    `json:"code"`
			Message string `json:"message"`
			Param   string `json:"param"`
		}
		if err := common.Unmarshal(data, &flat); err != nil {
			return err
		}
		event["error"], _ = common.Marshal(types.OpenAIError{Type: "server_error", Code: flat.Code, Message: flat.Message, Param: flat.Param})
		if len(event["status"]) == 0 {
			event["status"] = common.RawMessage("500")
		}
	}
	if raw := event["response"]; len(raw) > 0 {
		var response struct {
			ID     string              `json:"id"`
			Output []common.RawMessage `json:"output"`
			Usage  common.RawMessage   `json:"usage"`
		}
		if err := common.Unmarshal(raw, &response); err != nil {
			return errors.New("invalid upstream response envelope")
		}
		if response.ID != "" {
			w.responseID = response.ID
		}
		if len(response.Usage) > 0 && !bytes.Equal(bytes.TrimSpace(response.Usage), []byte("null")) {
			w.usage = response.Usage
		}
		if kind == "response.completed" || kind == "response.done" {
			w.completed = true
			w.output = response.Output
		}
	}
	if kind == "response.output_item.done" && !w.outputOverflow {
		var item struct {
			Status string `json:"status"`
		}
		var index int
		if common.Unmarshal(event["item"], &item) == nil && common.Unmarshal(event["output_index"], &index) == nil && index >= 0 &&
			(item.Status == "" || item.Status == "completed") {
			if w.completedItems == nil {
				w.completedItems = make(map[int]common.RawMessage)
			}
			if previous, exists := w.completedItems[index]; exists {
				w.outputBytes += len(event["item"]) - len(previous)
			} else {
				w.outputBytes += len(event["item"]) + 24
			}
			if w.outputBytes > responsesWSHTTPContextBytes {
				w.outputOverflow = true
				w.completedItems = nil
			} else {
				w.completedItems[index] = event["item"]
			}
		}
	}
	body, err := common.Marshal(event)
	if err != nil {
		return err
	}
	switch kind {
	case "response.completed", "response.done", "response.failed", "response.incomplete", "response.cancelled", "response.canceled", "error", "response.error":
		w.terminal = true
		w.state.terminal = &responsesWSMessage{kind: websocket.TextMessage, body: body}
		return nil
	default:
		return w.session.writeClient(websocket.TextMessage, body)
	}
}

func (w *responsesWSHTTPWriter) applyControl(control responsesWSControl) (bool, error) {
	var event struct {
		ResponseID string `json:"response_id"`
	}
	if err := common.Unmarshal(control.body, &event); err != nil {
		return false, errors.New("invalid response control event")
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if control.kind == "response.interrupt" {
		accepted := event.ResponseID == w.responseID && (control.streamID == "" || control.streamID == w.streamID)
		body, err := buildResponsesWSInterruptAck(control, accepted)
		if err != nil {
			return false, err
		}
		if err := w.session.writeClient(websocket.TextMessage, body); err != nil {
			w.session.shutdown(websocket.CloseInternalServerErr, "")
			return false, err
		}
		if !accepted || w.terminal || w.interrupted {
			return false, nil
		}
		w.interrupted = true
		return true, nil
	}
	if w.terminal {
		return false, errors.New("response has already completed")
	}
	if control.streamID != "" && control.streamID != w.streamID {
		return false, errors.New("response.cancel stream_id does not match the active response")
	}
	if event.ResponseID != "" && event.ResponseID != w.responseID {
		return false, errors.New("response.cancel response_id does not match the active response")
	}
	return true, nil
}
