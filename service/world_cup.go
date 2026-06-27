package service

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
)

const (
	defaultWorldCupScheduleURL = "https://apis.juhe.cn/fapigw/worldcup2026/schedule"
	defaultWorldCupAPIKey      = "6d16aeb565bd015359f73f4b24f90c4e"
	worldCupMCPProtocolVersion = "2024-11-05"
	worldCupScheduleToolName   = "get_worldcup_schedule"

	defaultWorldCupSettlementTickInterval = 30 * time.Minute
	worldCupScheduleCachePrefix           = "world_cup_schedule:v1:"
	worldCupScheduleDailyLimitKey         = "world_cup_schedule:daily_limit:"
)

var (
	worldCupSettlementOnce          sync.Once
	worldCupSettlementRunning       atomic.Bool
	worldCupScheduleCacheMu         sync.RWMutex
	worldCupScheduleCache           = map[string]worldCupScheduleMemoryEntry{}
	worldCupScheduleDailyLimitMu    sync.Mutex
	worldCupScheduleDailyLimitDay   string
	worldCupScheduleDailyLimitCount int
)

type WorldCupScheduleQuery struct {
	Type   string
	TeamId string
	Date   string
}

type WorldCupScheduleResult struct {
	Reason string                `json:"reason"`
	Data   []WorldCupScheduleDay `json:"data"`
}

type WorldCupScheduleDay struct {
	ScheduleDate       string          `json:"schedule_date"`
	ScheduleDateFormat string          `json:"schedule_date_format"`
	ScheduleWeek       string          `json:"schedule_week"`
	ScheduleCurrent    string          `json:"schedule_current"`
	ScheduleList       []WorldCupMatch `json:"schedule_list"`
}

type WorldCupMatch struct {
	TeamId                string `json:"team_id"`
	Date                  string `json:"date"`
	DateTime              string `json:"date_time"`
	HostTeamId            string `json:"host_team_id"`
	GuestTeamId           string `json:"guest_team_id"`
	HostTeamName          string `json:"host_team_name"`
	GuestTeamName         string `json:"guest_team_name"`
	HostTeamScore         string `json:"host_team_score"`
	HostTeamPenaltyScore  string `json:"host_team_penalty_score"`
	HostTeamBigScore      string `json:"host_team_bigscore"`
	GuestTeamScore        string `json:"guest_team_score"`
	GuestTeamPenaltyScore string `json:"guest_team_penalty_score"`
	GuestTeamBigScore     string `json:"guest_team_bigscore"`
	MatchStatus           string `json:"match_status"`
	MatchDescription      string `json:"match_des"`
	MatchType             string `json:"match_type"`
	MatchTypeName         string `json:"match_type_name"`
	MatchTypeDescription  string `json:"match_type_des"`
	GroupName             string `json:"group_name"`
	HostTeamLogoURL       string `json:"host_team_logo_url"`
	GuestTeamLogoURL      string `json:"guest_team_logo_url"`
}

func (m WorldCupMatch) MatchId() string {
	if strings.TrimSpace(m.TeamId) != "" {
		return strings.TrimSpace(m.TeamId)
	}
	parts := []string{
		strings.TrimSpace(m.DateTime),
		strings.TrimSpace(m.HostTeamId),
		strings.TrimSpace(m.GuestTeamId),
	}
	return strings.Join(parts, "_")
}

func (m WorldCupMatch) StartUnix() (int64, error) {
	dateTime := strings.TrimSpace(m.DateTime)
	if dateTime == "" {
		return 0, errors.New("match date_time is empty")
	}
	t, err := time.ParseInLocation("2006-01-02 15:04:05", dateTime, model.WorldCupLocation())
	if err != nil {
		return 0, err
	}
	return t.Unix(), nil
}

type worldCupScheduleEnvelope struct {
	Reason     string `json:"reason"`
	ResultCode string `json:"resultcode"`
	ErrorCode  int    `json:"error_code"`
	Result     struct {
		Data []WorldCupScheduleDay `json:"data"`
	} `json:"result"`
}

type mcpError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type mcpResponse struct {
	Id     int       `json:"id"`
	Error  *mcpError `json:"error,omitempty"`
	Result struct {
		Content []mcpContent `json:"content"`
	} `json:"result"`
}

type mcpSSEEvent struct {
	Event string
	Data  string
}

type worldCupScheduleMemoryEntry struct {
	Result    *WorldCupScheduleResult
	ExpiresAt int64
}

func StartWorldCupPredictionSettlementTask() {
	worldCupSettlementOnce.Do(func() {
		if !common.IsMasterNode {
			return
		}
		gopool.Go(func() {
			tick := worldCupSettlementTickInterval()
			logger.LogInfo(context.Background(), fmt.Sprintf("world cup schedule refresh task started: tick=%s", tick))
			ticker := time.NewTicker(tick)
			defer ticker.Stop()

			runWorldCupPredictionSettlementOnce()
			for range ticker.C {
				runWorldCupPredictionSettlementOnce()
			}
		})
	})
}

func worldCupSettlementTickInterval() time.Duration {
	tick := time.Duration(model.WorldCupSettlementCheckIntervalSeconds()) * time.Second
	if tick <= 0 {
		return defaultWorldCupSettlementTickInterval
	}
	return tick
}

func runWorldCupPredictionSettlementOnce() {
	if !worldCupSettlementRunning.CompareAndSwap(false, true) {
		return
	}
	defer worldCupSettlementRunning.Store(false)

	ctx := context.Background()
	if _, err := FetchWorldCupSchedule(ctx, WorldCupScheduleQuery{}); err != nil {
		logger.LogWarn(ctx, fmt.Sprintf("world cup schedule refresh failed: %v", err))
	}
}

func FetchWorldCupSchedule(ctx context.Context, query WorldCupScheduleQuery) (*WorldCupScheduleResult, error) {
	query.Type = strings.TrimSpace(query.Type)
	query.TeamId = strings.TrimSpace(query.TeamId)
	query.Date = strings.TrimSpace(query.Date)

	cacheKey := worldCupScheduleCacheKey(query)
	if cached := getCachedWorldCupSchedule(cacheKey); cached != nil {
		return cached, nil
	}

	worldCupScheduleCacheMu.Lock()
	defer worldCupScheduleCacheMu.Unlock()
	if cached := getCachedWorldCupScheduleLocked(cacheKey); cached != nil {
		return cached, nil
	}
	if cached := getCachedWorldCupScheduleFromFullQueryLocked(query); cached != nil {
		return cached, nil
	}
	var result *WorldCupScheduleResult
	var err error
	key := worldCupAPIKey()
	mcpURL := worldCupMCPURL()
	if key == "" && mcpURL == "" {
		return nil, errors.New("world cup schedule source is not configured")
	}
	if !allowWorldCupScheduleExternalFetch(ctx, time.Now()) {
		if stale := getStaleCachedWorldCupScheduleLocked(cacheKey); stale != nil {
			return stale, nil
		}
		if stale := getStaleCachedWorldCupScheduleFromFullQueryLocked(query); stale != nil {
			return stale, nil
		}
		return nil, errors.New("world cup schedule daily request limit reached")
	}
	if key != "" {
		result, err = fetchWorldCupScheduleREST(ctx, key, query)
	} else if mcpURL != "" {
		result, err = fetchWorldCupScheduleMCP(ctx, mcpURL, query)
	}
	if err != nil {
		if stale := getStaleCachedWorldCupScheduleLocked(cacheKey); stale != nil {
			logger.LogWarn(ctx, fmt.Sprintf("world cup schedule fetch failed, using stale cache: %v", err))
			return stale, nil
		}
		if stale := getStaleCachedWorldCupScheduleFromFullQueryLocked(query); stale != nil {
			logger.LogWarn(ctx, fmt.Sprintf("world cup schedule fetch failed, using stale full cache: %v", err))
			return stale, nil
		}
		return nil, err
	}
	setCachedWorldCupScheduleLocked(cacheKey, result)
	settleWorldCupPredictionsFromScheduleAsync(result)
	return cloneWorldCupScheduleResult(result), nil
}

func FindWorldCupMatch(schedule *WorldCupScheduleResult, matchId string) (WorldCupMatch, bool) {
	if schedule == nil || strings.TrimSpace(matchId) == "" {
		return WorldCupMatch{}, false
	}
	for _, day := range schedule.Data {
		for _, match := range day.ScheduleList {
			if match.MatchId() == matchId {
				return match, true
			}
		}
	}
	return WorldCupMatch{}, false
}

func BuildWorldCupOutcome(match WorldCupMatch) (model.WorldCupMatchOutcome, bool) {
	if match.MatchId() == "" || strings.TrimSpace(match.Date) == "" {
		return model.WorldCupMatchOutcome{}, false
	}
	if match.MatchStatus != "3" && !strings.Contains(match.MatchDescription, "完") {
		return model.WorldCupMatchOutcome{}, false
	}
	hostScore, err := strconv.Atoi(strings.TrimSpace(match.HostTeamScore))
	if err != nil {
		return model.WorldCupMatchOutcome{}, false
	}
	guestScore, err := strconv.Atoi(strings.TrimSpace(match.GuestTeamScore))
	if err != nil {
		return model.WorldCupMatchOutcome{}, false
	}
	choice := model.WorldCupChoiceDraw
	if hostScore > guestScore {
		choice = model.WorldCupChoiceHost
	} else if guestScore > hostScore {
		choice = model.WorldCupChoiceGuest
	}
	return model.WorldCupMatchOutcome{
		MatchId:    match.MatchId(),
		MatchDate:  strings.TrimSpace(match.Date),
		Choice:     choice,
		HostScore:  hostScore,
		GuestScore: guestScore,
	}, true
}

func settleWorldCupPredictionsFromScheduleAsync(schedule *WorldCupScheduleResult) {
	schedule = cloneWorldCupScheduleResult(schedule)
	if schedule == nil {
		return
	}
	gopool.Go(func() {
		settleWorldCupPredictionsFromSchedule(context.Background(), schedule)
	})
}

func settleWorldCupPredictionsFromSchedule(ctx context.Context, schedule *WorldCupScheduleResult) {
	if schedule == nil {
		return
	}
	type settlementItem struct {
		Outcome   model.WorldCupMatchOutcome
		StartUnix int64
	}
	items := make([]settlementItem, 0)
	for _, day := range schedule.Data {
		for _, match := range day.ScheduleList {
			outcome, ok := BuildWorldCupOutcome(match)
			if !ok {
				continue
			}
			startUnix, _ := match.StartUnix()
			items = append(items, settlementItem{Outcome: outcome, StartUnix: startUnix})
		}
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].StartUnix == items[j].StartUnix {
			return items[i].Outcome.MatchId < items[j].Outcome.MatchId
		}
		return items[i].StartUnix < items[j].StartUnix
	})
	for _, item := range items {
		won, lost, err := model.SettleWorldCupPredictions(item.Outcome)
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("world cup prediction settlement failed match_id=%s date=%s: %v", item.Outcome.MatchId, item.Outcome.MatchDate, err))
			continue
		}
		if won > 0 || lost > 0 {
			logger.LogInfo(ctx, fmt.Sprintf("world cup prediction settled match_id=%s date=%s won=%d lost=%d", item.Outcome.MatchId, item.Outcome.MatchDate, won, lost))
		}
	}
}

func FilterWorldCupCurrentAndFuture(schedule *WorldCupScheduleResult, now time.Time) *WorldCupScheduleResult {
	if schedule == nil {
		return &WorldCupScheduleResult{}
	}
	filtered := &WorldCupScheduleResult{
		Reason: schedule.Reason,
		Data:   make([]WorldCupScheduleDay, 0, len(schedule.Data)),
	}
	nowUnix := now.In(model.WorldCupLocation()).Unix()
	for _, day := range schedule.Data {
		nextDay := day
		nextDay.ScheduleList = make([]WorldCupMatch, 0, len(day.ScheduleList))
		for _, match := range day.ScheduleList {
			if isWorldCupMatchFinished(match) {
				continue
			}
			startUnix, err := match.StartUnix()
			if err == nil && startUnix > 0 && startUnix < nowUnix &&
				nowUnix-startUnix > int64(3*time.Hour/time.Second) &&
				!isWorldCupMatchLikelyLive(match) {
				continue
			}
			nextDay.ScheduleList = append(nextDay.ScheduleList, match)
		}
		if len(nextDay.ScheduleList) > 0 {
			filtered.Data = append(filtered.Data, nextDay)
		}
	}
	return filtered
}

func FilterWorldCupCompleted(schedule *WorldCupScheduleResult) *WorldCupScheduleResult {
	if schedule == nil {
		return &WorldCupScheduleResult{}
	}
	filtered := &WorldCupScheduleResult{
		Reason: schedule.Reason,
		Data:   make([]WorldCupScheduleDay, 0, len(schedule.Data)),
	}
	for _, day := range schedule.Data {
		nextDay := day
		nextDay.ScheduleList = make([]WorldCupMatch, 0, len(day.ScheduleList))
		for _, match := range day.ScheduleList {
			if isWorldCupMatchFinished(match) {
				nextDay.ScheduleList = append(nextDay.ScheduleList, match)
			}
		}
		if len(nextDay.ScheduleList) > 0 {
			filtered.Data = append(filtered.Data, nextDay)
		}
	}
	return filtered
}

func isWorldCupMatchFinished(match WorldCupMatch) bool {
	return match.MatchStatus == "3" || strings.Contains(match.MatchDescription, "完")
}

func isWorldCupMatchLikelyLive(match WorldCupMatch) bool {
	if isWorldCupMatchFinished(match) {
		return false
	}
	return strings.TrimSpace(match.MatchStatus) != "" || strings.TrimSpace(match.MatchDescription) != ""
}

func fetchWorldCupScheduleREST(ctx context.Context, key string, query WorldCupScheduleQuery) (*WorldCupScheduleResult, error) {
	endpoint := worldCupScheduleURL()
	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	params := u.Query()
	params.Set("key", key)
	if strings.TrimSpace(query.Type) != "" {
		params.Set("type", strings.TrimSpace(query.Type))
	}
	if strings.TrimSpace(query.TeamId) != "" {
		params.Set("team_id", strings.TrimSpace(query.TeamId))
	}
	if strings.TrimSpace(query.Date) != "" {
		params.Set("date", strings.TrimSpace(query.Date))
	}
	u.RawQuery = params.Encode()

	client := GetHttpClient()
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("world cup schedule http status %d", resp.StatusCode)
	}
	var envelope worldCupScheduleEnvelope
	if err := common.DecodeJson(resp.Body, &envelope); err != nil {
		return nil, err
	}
	if envelope.ErrorCode != 0 || (envelope.ResultCode != "" && envelope.ResultCode != "200") {
		return nil, fmt.Errorf("world cup schedule error: %s", envelope.Reason)
	}
	return &WorldCupScheduleResult{Reason: envelope.Reason, Data: envelope.Result.Data}, nil
}

func fetchWorldCupScheduleMCP(parent context.Context, mcpURL string, query WorldCupScheduleQuery) (*WorldCupScheduleResult, error) {
	ctx, cancel := context.WithTimeout(parent, 35*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, mcpURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/event-stream")

	client := GetHttpClient()
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("world cup mcp sse status %d", resp.StatusCode)
	}

	reader := bufio.NewReader(resp.Body)
	endpointEvent, err := readMCPSSEEvent(reader)
	if err != nil {
		return nil, err
	}
	if endpointEvent.Event != "endpoint" || strings.TrimSpace(endpointEvent.Data) == "" {
		return nil, errors.New("world cup mcp endpoint not received")
	}
	postURL, err := resolveMCPPostURL(mcpURL, endpointEvent.Data)
	if err != nil {
		return nil, err
	}

	if err := postMCPMessage(ctx, client, postURL, map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": worldCupMCPProtocolVersion,
			"capabilities":    map[string]any{},
			"clientInfo": map[string]string{
				"name":    "new-api-world-cup",
				"version": common.Version,
			},
		},
	}); err != nil {
		return nil, err
	}
	if _, err := readMCPResponse(reader, 1); err != nil {
		return nil, err
	}
	if err := postMCPMessage(ctx, client, postURL, map[string]any{
		"jsonrpc": "2.0",
		"method":  "notifications/initialized",
		"params":  map[string]any{},
	}); err != nil {
		return nil, err
	}

	args := map[string]string{}
	if strings.TrimSpace(query.Type) != "" {
		args["type"] = strings.TrimSpace(query.Type)
	}
	if strings.TrimSpace(query.TeamId) != "" {
		args["team_id"] = strings.TrimSpace(query.TeamId)
	}
	if strings.TrimSpace(query.Date) != "" {
		args["date"] = strings.TrimSpace(query.Date)
	}
	if err := postMCPMessage(ctx, client, postURL, map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      worldCupScheduleToolName,
			"arguments": args,
		},
	}); err != nil {
		return nil, err
	}
	msg, err := readMCPResponse(reader, 2)
	if err != nil {
		return nil, err
	}
	if len(msg.Result.Content) == 0 || strings.TrimSpace(msg.Result.Content[0].Text) == "" {
		return nil, errors.New("world cup mcp returned empty schedule")
	}
	var envelope worldCupScheduleEnvelope
	if err := common.UnmarshalJsonStr(msg.Result.Content[0].Text, &envelope); err != nil {
		return nil, err
	}
	if envelope.ErrorCode != 0 || (envelope.ResultCode != "" && envelope.ResultCode != "200") {
		return nil, fmt.Errorf("world cup schedule error: %s", envelope.Reason)
	}
	return &WorldCupScheduleResult{Reason: envelope.Reason, Data: envelope.Result.Data}, nil
}

func readMCPResponse(reader *bufio.Reader, id int) (*mcpResponse, error) {
	for {
		event, err := readMCPSSEEvent(reader)
		if err != nil {
			return nil, err
		}
		if event.Event != "message" || strings.TrimSpace(event.Data) == "" {
			continue
		}
		var msg mcpResponse
		if err := common.Unmarshal([]byte(event.Data), &msg); err != nil {
			return nil, err
		}
		if msg.Id != id {
			continue
		}
		if msg.Error != nil {
			return nil, fmt.Errorf("world cup mcp error %d: %s", msg.Error.Code, msg.Error.Message)
		}
		return &msg, nil
	}
}

func readMCPSSEEvent(reader *bufio.Reader) (mcpSSEEvent, error) {
	var event mcpSSEEvent
	var data []string
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if errors.Is(err, io.EOF) && (event.Event != "" || len(data) > 0) {
				event.Data = strings.Join(data, "\n")
				return event, nil
			}
			return mcpSSEEvent{}, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if event.Event == "" && len(data) == 0 {
				continue
			}
			event.Data = strings.Join(data, "\n")
			return event, nil
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		if strings.HasPrefix(line, "event:") {
			event.Event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			continue
		}
		if strings.HasPrefix(line, "data:") {
			data = append(data, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
}

func postMCPMessage(ctx context.Context, client *http.Client, endpoint string, payload any) error {
	body, err := common.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("world cup mcp post status %d", resp.StatusCode)
	}
	return nil
}

func resolveMCPPostURL(sseURL string, endpoint string) (string, error) {
	if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
		return endpoint, nil
	}
	base, err := url.Parse(sseURL)
	if err != nil {
		return "", err
	}
	base.Path = endpoint
	base.RawQuery = ""
	base.Fragment = ""
	return base.String(), nil
}

func worldCupScheduleURL() string {
	return firstWorldCupConfigValue(
		[]string{"WORLD_CUP_SCHEDULE_URL", "JUHE_WORLD_CUP_SCHEDULE_URL"},
		[]string{"WorldCupScheduleURL", "JuheWorldCupScheduleURL"},
		defaultWorldCupScheduleURL,
	)
}

func worldCupAPIKey() string {
	return firstWorldCupConfigValue(
		[]string{"WORLD_CUP_API_KEY", "JUHE_WORLD_CUP_API_KEY", "JUHE_API_KEY"},
		[]string{"WorldCupAPIKey", "JuheWorldCupAPIKey", "JuheAPIKey"},
		defaultWorldCupAPIKey,
	)
}

func worldCupMCPURL() string {
	return firstWorldCupConfigValue(
		[]string{"WORLD_CUP_MCP_URL", "JUHE_WORLD_CUP_MCP_URL", "JUHE_MCP_URL"},
		[]string{"WorldCupMCPURL", "JuheWorldCupMCPURL", "JuheMCPURL"},
		"",
	)
}

func worldCupScheduleCacheTTL() time.Duration {
	raw := firstWorldCupConfigValue(
		[]string{"WORLD_CUP_SCHEDULE_CACHE_TTL_SECONDS", "JUHE_WORLD_CUP_CACHE_TTL_SECONDS"},
		[]string{"WorldCupScheduleCacheTTLSeconds", "JuheWorldCupCacheTTLSeconds"},
		"1800",
	)
	seconds, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || seconds <= 0 {
		seconds = 1800
	}
	return time.Duration(seconds) * time.Second
}

func worldCupScheduleDailyRequestLimit() int {
	raw := firstWorldCupConfigValue(
		[]string{"WORLD_CUP_SCHEDULE_DAILY_REQUEST_LIMIT", "JUHE_WORLD_CUP_DAILY_REQUEST_LIMIT"},
		[]string{"WorldCupScheduleDailyRequestLimit", "JuheWorldCupDailyRequestLimit"},
		"50",
	)
	limit, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || limit <= 0 {
		return 50
	}
	return limit
}

func allowWorldCupScheduleExternalFetch(ctx context.Context, now time.Time) bool {
	limit := worldCupScheduleDailyRequestLimit()
	day := now.In(model.WorldCupLocation()).Format("2006-01-02")
	if common.RedisEnabled && common.RDB != nil {
		key := worldCupScheduleDailyLimitKey + day
		count, err := common.RDB.Incr(ctx, key).Result()
		if err != nil {
			logger.LogWarn(ctx, fmt.Sprintf("world cup schedule daily limit redis incr failed: %v", err))
			return allowWorldCupScheduleExternalFetchInMemory(day, limit)
		}
		if count == 1 {
			nextDay := now.In(model.WorldCupLocation()).AddDate(0, 0, 1)
			expiresAt := time.Date(nextDay.Year(), nextDay.Month(), nextDay.Day(), 0, 10, 0, 0, model.WorldCupLocation())
			_ = common.RDB.Expire(ctx, key, time.Until(expiresAt)).Err()
		}
		return count <= int64(limit)
	}
	return allowWorldCupScheduleExternalFetchInMemory(day, limit)
}

func allowWorldCupScheduleExternalFetchInMemory(day string, limit int) bool {
	worldCupScheduleDailyLimitMu.Lock()
	defer worldCupScheduleDailyLimitMu.Unlock()
	if worldCupScheduleDailyLimitDay != day {
		worldCupScheduleDailyLimitDay = day
		worldCupScheduleDailyLimitCount = 0
	}
	if worldCupScheduleDailyLimitCount >= limit {
		return false
	}
	worldCupScheduleDailyLimitCount++
	return true
}

func worldCupScheduleCacheKey(query WorldCupScheduleQuery) string {
	parts := []string{
		"type=" + strings.TrimSpace(query.Type),
		"team=" + strings.TrimSpace(query.TeamId),
		"date=" + strings.TrimSpace(query.Date),
	}
	return worldCupScheduleCachePrefix + strings.Join(parts, "&")
}

func getCachedWorldCupSchedule(cacheKey string) *WorldCupScheduleResult {
	worldCupScheduleCacheMu.RLock()
	cached := getCachedWorldCupScheduleLocked(cacheKey)
	worldCupScheduleCacheMu.RUnlock()
	return cached
}

func getCachedWorldCupScheduleLocked(cacheKey string) *WorldCupScheduleResult {
	now := time.Now().Unix()
	if entry, ok := worldCupScheduleCache[cacheKey]; ok {
		if entry.ExpiresAt > now && entry.Result != nil {
			return cloneWorldCupScheduleResult(entry.Result)
		}
	}

	if common.RedisEnabled && common.RDB != nil {
		raw, err := common.RedisGet(cacheKey)
		if err == nil && strings.TrimSpace(raw) != "" {
			var result WorldCupScheduleResult
			if err := common.UnmarshalJsonStr(raw, &result); err == nil {
				return cloneWorldCupScheduleResult(&result)
			}
		}
	}
	return nil
}

func getStaleCachedWorldCupScheduleLocked(cacheKey string) *WorldCupScheduleResult {
	if entry, ok := worldCupScheduleCache[cacheKey]; ok && entry.Result != nil {
		return cloneWorldCupScheduleResult(entry.Result)
	}
	return nil
}

func getCachedWorldCupScheduleFromFullQueryLocked(query WorldCupScheduleQuery) *WorldCupScheduleResult {
	if !canFilterWorldCupFullSchedule(query) {
		return nil
	}
	full := getCachedWorldCupScheduleLocked(worldCupScheduleCacheKey(WorldCupScheduleQuery{}))
	return filterWorldCupFullSchedule(full, query)
}

func getStaleCachedWorldCupScheduleFromFullQueryLocked(query WorldCupScheduleQuery) *WorldCupScheduleResult {
	if !canFilterWorldCupFullSchedule(query) {
		return nil
	}
	full := getStaleCachedWorldCupScheduleLocked(worldCupScheduleCacheKey(WorldCupScheduleQuery{}))
	return filterWorldCupFullSchedule(full, query)
}

func canFilterWorldCupFullSchedule(query WorldCupScheduleQuery) bool {
	return strings.TrimSpace(query.Type) == "" &&
		strings.TrimSpace(query.TeamId) == "" &&
		strings.TrimSpace(query.Date) != ""
}

func filterWorldCupFullSchedule(schedule *WorldCupScheduleResult, query WorldCupScheduleQuery) *WorldCupScheduleResult {
	if schedule == nil {
		return nil
	}
	date := strings.TrimSpace(query.Date)
	filtered := &WorldCupScheduleResult{
		Reason: schedule.Reason,
		Data:   make([]WorldCupScheduleDay, 0, len(schedule.Data)),
	}
	for _, day := range schedule.Data {
		nextDay := day
		nextDay.ScheduleList = make([]WorldCupMatch, 0, len(day.ScheduleList))
		for _, match := range day.ScheduleList {
			if strings.TrimSpace(match.Date) == date ||
				(strings.TrimSpace(match.Date) == "" && strings.TrimSpace(day.ScheduleDate) == date) {
				nextDay.ScheduleList = append(nextDay.ScheduleList, match)
			}
		}
		if len(nextDay.ScheduleList) > 0 {
			filtered.Data = append(filtered.Data, nextDay)
		}
	}
	if len(filtered.Data) == 0 {
		return nil
	}
	return filtered
}

func setCachedWorldCupSchedule(cacheKey string, result *WorldCupScheduleResult) {
	worldCupScheduleCacheMu.Lock()
	defer worldCupScheduleCacheMu.Unlock()
	setCachedWorldCupScheduleLocked(cacheKey, result)
}

func setCachedWorldCupScheduleLocked(cacheKey string, result *WorldCupScheduleResult) {
	if result == nil {
		return
	}
	ttl := worldCupScheduleCacheTTL()
	worldCupScheduleCache[cacheKey] = worldCupScheduleMemoryEntry{
		Result:    cloneWorldCupScheduleResult(result),
		ExpiresAt: time.Now().Add(ttl).Unix(),
	}
	if common.RedisEnabled && common.RDB != nil {
		data, err := common.Marshal(result)
		if err == nil {
			_ = common.RedisSet(cacheKey, string(data), ttl)
		}
	}
}

func cloneWorldCupScheduleResult(result *WorldCupScheduleResult) *WorldCupScheduleResult {
	if result == nil {
		return nil
	}
	clone := &WorldCupScheduleResult{
		Reason: result.Reason,
		Data:   make([]WorldCupScheduleDay, len(result.Data)),
	}
	for i, day := range result.Data {
		clone.Data[i] = day
		if day.ScheduleList != nil {
			clone.Data[i].ScheduleList = append([]WorldCupMatch(nil), day.ScheduleList...)
		}
	}
	return clone
}

func firstWorldCupConfigValue(envKeys []string, optionKeys []string, fallback string) string {
	for _, key := range envKeys {
		if value := strings.TrimSpace(common.GetEnvOrDefaultString(key, "")); value != "" {
			return value
		}
	}
	if common.OptionMap != nil {
		common.OptionMapRWMutex.RLock()
		defer common.OptionMapRWMutex.RUnlock()
		for _, key := range optionKeys {
			if value := strings.TrimSpace(common.OptionMap[key]); value != "" {
				return value
			}
		}
	}
	return fallback
}
