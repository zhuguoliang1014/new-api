// telegram-order-bot runs separately from the gateway with a read-only database role.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	orderPrompt   = "请发送你在 AiProxy 的完整订单号。\n\n打开「<a href=\"https://92ai.asia/orders\">我的订单</a>」，复制订单号后发送给我。\n充值或套餐的任意已付款订单均可。\n\n请在 10 分钟内提交。\n不要发送 API Key、密码或付款截图。"
	orderRejected = "订单未通过验证。请确认复制的是主站完整订单号、已经付款，且未被其他 Telegram 账号领取。仍有问题请联系管理员。"
)

var orderNumber = regexp.MustCompile(`^[A-Za-z0-9_-]{6,255}$`)

type config struct {
	Token       string `json:"token"`
	BotUsername string `json:"bot_username"`
	GroupID     int64  `json:"group_id"`
	Driver      string `json:"driver"`
	DSN         string `json:"dsn"`
	StatePath   string `json:"state_path"`
}

type window struct {
	Start int64 `json:"start"`
	Count int   `json:"count"`
}

func (w *window) allow(now int64, seconds int64, limit int) bool {
	if now >= w.Start+seconds {
		w.Start, w.Count = now, 0
	}
	if w.Count >= limit {
		return false
	}
	w.Count++
	return true
}

type conversation struct {
	PendingUntil int64  `json:"pending_until"`
	Seen         int64  `json:"seen"`
	Messages     window `json:"messages"`
	Attempts     window `json:"attempts"`
}

type state struct {
	Version  int                      `json:"version"`
	Offset   int64                    `json:"offset"`
	Claims   map[string]int64         `json:"claims"`   // SHA-256 of canonical order number -> Telegram user ID
	Bindings map[string]int           `json:"bindings"` // Telegram user ID -> main-site user ID; never a login binding
	Users    map[string]*conversation `json:"users"`
	Global   window                   `json:"global"`
	Invites  map[string]*invitation   `json:"invites"` // Telegram user ID -> short-lived, account-bound grant
}

type invitation struct {
	URL        string `json:"url"`
	ExpiresAt  int64  `json:"expires_at"`
	SiteUserID int    `json:"site_user_id"`
	ConsumedBy int64  `json:"consumed_by,omitempty"` // Update ID reserved before approval
	Approved   bool   `json:"approved,omitempty"`
}

func loadState(path string) (*state, error) {
	s := &state{}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return &state{Version: 3, Claims: map[string]int64{}, Bindings: map[string]int{}, Users: map[string]*conversation{}, Invites: map[string]*invitation{}}, nil
	}
	if err != nil {
		return nil, errors.New("cannot read bot state")
	}
	if common.Unmarshal(data, s) != nil || (s.Version < 1 || s.Version > 3) || s.Claims == nil || s.Users == nil {
		return nil, errors.New("invalid bot state; restore it before starting")
	}
	// Version 1 stored order claims only. Preserve them and populate associations on re-verification.
	if s.Version == 1 && s.Bindings == nil {
		s.Bindings = map[string]int{}
	}
	if s.Bindings == nil {
		return nil, errors.New("missing account associations; restore state before starting")
	}
	if s.Version < 3 && s.Invites == nil {
		s.Invites = map[string]*invitation{}
	}
	if s.Invites == nil {
		return nil, errors.New("missing invitation state; restore state before starting")
	}
	s.Version = 3
	accounts := map[int]bool{}
	for telegramID, userID := range s.Bindings {
		id, err := strconv.ParseInt(telegramID, 10, 64)
		if err != nil || id <= 0 || userID <= 0 || accounts[userID] {
			return nil, errors.New("invalid account associations; restore state before starting")
		}
		accounts[userID] = true
	}
	for _, user := range s.Users {
		if user == nil {
			return nil, errors.New("invalid conversation state; restore it before starting")
		}
	}
	urls := map[string]bool{}
	for id, invite := range s.Invites {
		if invite == nil || s.Bindings[id] != invite.SiteUserID || invite.SiteUserID <= 0 || !validInviteURL(invite.URL) || invite.ExpiresAt <= 0 || invite.ConsumedBy < 0 || (invite.Approved && invite.ConsumedBy == 0) || urls[invite.URL] {
			return nil, errors.New("invalid invitation state; restore state before starting")
		}
		urls[invite.URL] = true
	}
	return s, nil
}

func validInviteURL(raw string) bool {
	invite, err := url.Parse(raw)
	return err == nil && invite.Scheme == "https" && invite.Host == "t.me" && invite.User == nil && strings.HasPrefix(invite.Path, "/+") && len(invite.Path) > 2 && invite.RawQuery == "" && invite.Fragment == ""
}

func (s *state) save(path string) error {
	data, err := common.Marshal(s)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".state-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), path); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func openDatabase(driver, dsn string) (*gorm.DB, error) {
	var dialect gorm.Dialector
	switch driver {
	case "postgres":
		dialect = postgres.Open(dsn)
	case "mysql":
		dialect = mysql.Open(dsn)
	case "sqlite":
		dialect = sqlite.Open(dsn)
	default:
		return nil, errors.New("unsupported database driver")
	}
	db, err := gorm.Open(dialect, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return nil, errors.New("database connection failed")
	}
	pool, err := db.DB()
	if err != nil {
		return nil, errors.New("database pool unavailable")
	}
	pool.SetMaxOpenConns(2)
	pool.SetMaxIdleConns(1)
	pool.SetConnMaxLifetime(5 * time.Minute)
	return db, nil
}

// A subscription payment may also have a top_ups mirror. Its own status is authoritative.
// No money, quota, credentials, profile data, or provider payload is read.
type orderIdentity struct {
	Hash   string
	UserID int
}

func paidOrder(ctx context.Context, db *gorm.DB, number string) (*orderIdentity, error) {
	for _, table := range []string{"subscription_orders", "top_ups"} {
		var rows []struct {
			TradeNo string
			UserID  int
			Status  string
		}
		if err := db.WithContext(ctx).Table(table).Select("trade_no, user_id, status").
			Where("trade_no = ?", number).Limit(2).Find(&rows).Error; err != nil {
			return nil, errors.New("order lookup failed")
		}
		if len(rows) == 0 {
			continue
		}
		if len(rows) != 1 || rows[0].TradeNo != number || rows[0].Status != "success" {
			return nil, nil
		}
		var count int64
		if err := db.WithContext(ctx).Table("users").Where("id = ? AND status = ? AND deleted_at IS NULL", rows[0].UserID, 1).Count(&count).Error; err != nil {
			return nil, errors.New("order owner lookup failed")
		}
		if count != 1 {
			return nil, nil
		}
		return &orderIdentity{Hash: fmt.Sprintf("%x", sha256.Sum256([]byte(rows[0].TradeNo))), UserID: rows[0].UserID}, nil
	}
	return nil, nil
}

type telegramUser struct {
	ID    int64 `json:"id"`
	IsBot bool  `json:"is_bot"`
}

type message struct {
	From *telegramUser `json:"from"`
	Chat struct {
		ID   int64  `json:"id"`
		Type string `json:"type"`
	} `json:"chat"`
	Text string `json:"text"`
}

type update struct {
	ID       int64    `json:"update_id"`
	Message  *message `json:"message"`
	Callback *struct {
		ID      string       `json:"id"`
		From    telegramUser `json:"from"`
		Message *message     `json:"message"`
		Data    string       `json:"data"`
	} `json:"callback_query"`
	JoinRequest *struct {
		Chat struct {
			ID int64 `json:"id"`
		} `json:"chat"`
		From       telegramUser `json:"from"`
		InviteLink *struct {
			URL string `json:"invite_link"`
		} `json:"invite_link"`
	} `json:"chat_join_request"`
}

type apiError struct {
	Code           int
	RetryAfter     int
	InviteInactive bool
}

func (e *apiError) Error() string { return fmt.Sprintf("Telegram API status %d", e.Code) }

type telegram struct {
	base   string
	client *http.Client
}

func (t *telegram) call(ctx context.Context, method string, payload any, result any) error {
	data, err := common.Marshal(payload)
	if err != nil {
		return errors.New("cannot encode Telegram request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.base+"/"+method, bytes.NewReader(data))
	if err != nil {
		return errors.New("cannot create Telegram request")
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.client.Do(req)
	if err != nil {
		// net/http errors contain the request URL, which includes the bot token.
		return errors.New("Telegram transport failed")
	}
	defer resp.Body.Close()
	var envelope struct {
		OK          bool   `json:"ok"`
		Code        int    `json:"error_code"`
		Description string `json:"description"`
		Result      any    `json:"result"`
		Parameters  struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	envelope.Result = result
	if err := common.DecodeJson(io.LimitReader(resp.Body, 4<<20), &envelope); err != nil {
		return errors.New("invalid Telegram response")
	}
	if !envelope.OK || resp.StatusCode != http.StatusOK {
		inactive := envelope.Code == 400 && (envelope.Description == "Bad Request: INVITE_HASH_EXPIRED" || envelope.Description == "Bad Request: INVITE_HASH_REVOKED")
		return &apiError{Code: envelope.Code, RetryAfter: envelope.Parameters.RetryAfter, InviteInactive: inactive}
	}
	return nil
}

type bot struct {
	cfg   config
	db    *gorm.DB
	state *state
	api   *telegram
	now   func() time.Time
}

func (b *bot) reply(ctx context.Context, chatID int64, text string, keyboard any, parseMode string) error {
	payload := map[string]any{"chat_id": chatID, "text": text, "protect_content": true, "link_preview_options": map[string]bool{"is_disabled": true}}
	if parseMode != "" {
		payload["parse_mode"] = parseMode
	}
	if keyboard != nil {
		payload["reply_markup"] = keyboard
	}
	return b.api.call(ctx, "sendMessage", payload, nil)
}

func (b *bot) handle(ctx context.Context, u update) error {
	if u.JoinRequest != nil {
		return b.handleJoinRequest(ctx, u)
	}
	m := u.Message
	action := ""
	if u.Callback != nil {
		c := u.Callback
		if c.Message == nil || c.Message.Chat.Type != "private" || c.From.IsBot || c.Message.Chat.ID != c.From.ID || c.Data != "join" {
			return nil
		}
		// The message's from is the bot; callback_query.from is the actual actor.
		copy := *c.Message
		copy.From = &c.From
		m, action = &copy, "/join"
		_ = b.api.call(ctx, "answerCallbackQuery", map[string]string{"callback_query_id": c.ID}, nil)
	}
	if m == nil || m.From == nil || m.From.IsBot || m.From.ID <= 0 || m.Chat.Type != "private" || m.Chat.ID != m.From.ID {
		return nil
	}
	now := b.now().Unix()
	id := strconv.FormatInt(m.From.ID, 10)
	for key, user := range b.state.Users {
		if user.Seen < now-86400 {
			delete(b.state.Users, key)
		}
	}
	user := b.state.Users[id]
	if user == nil {
		user = &conversation{}
		b.state.Users[id] = user
	}
	user.Seen = now
	if !user.Messages.allow(now, 60, 12) {
		return nil
	}
	text := strings.TrimSpace(m.Text)
	if action == "" && strings.HasPrefix(text, "/") {
		command, _, _ := strings.Cut(text, " ")
		command, target, hasTarget := strings.Cut(command, "@")
		if hasTarget && !strings.EqualFold(target, b.cfg.BotUsername) {
			return nil
		}
		action = command
	}
	var response string
	var keyboard any
	var parseMode string
	verifiedUserID := 0
	switch action {
	case "/start", "/help":
		user.PendingUntil = 0
		response = "欢迎使用 AiProxy 小助理！\n持有 https://92ai.asia 任意一笔已付款订单即可申请加入用户群。\n点击「加入群聊」后提交订单号，验证通过即可获得邀请链接。"
		if userID := b.state.Bindings[id]; userID != 0 {
			response += fmt.Sprintf("\n\n当前已关联主站用户 ID：%d", userID)
		}
		keyboard = map[string]any{"inline_keyboard": [][]map[string]string{{{"text": "加入群聊", "callback_data": "join"}}, {{"text": "打开 AiProxy 官网", "url": "https://92ai.asia"}}}}
	case "/join":
		user.PendingUntil = now + 600
		response = orderPrompt
		parseMode = "HTML"
	case "/cancel":
		user.PendingUntil = 0
		response = "已取消订单验证。发送 /join 可重新开始。"
	default:
		if user.PendingUntil <= now {
			response = "请先发送 /join 开始订单验证（验证会话有效期为 10 分钟）。"
			break
		}
		if !user.Attempts.allow(now, 600, 5) || !b.state.Global.allow(now, 60, 120) {
			log.Printf("order verification throttled telegram_user=%d", m.From.ID)
			response = "验证尝试过于频繁，请稍后再试。每个账号 10 分钟内最多验证 5 次，发送 /join 不会重置次数。"
			break
		}
		// Persist throttling before querying or sending; restarts do not reset it.
		if err := b.state.save(b.cfg.StatePath); err != nil {
			return err
		}
		if !orderNumber.MatchString(text) {
			log.Printf("order verification denied telegram_user=%d reason=invalid-format", m.From.ID)
			response = orderRejected
			break
		}
		queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		order, err := paidOrder(queryCtx, b.db, text)
		cancel()
		if err != nil {
			log.Printf("order lookup unavailable telegram_user=%d", m.From.ID)
			response = "订单查询暂时不可用，请稍后重试。"
			break
		}
		if order == nil {
			log.Printf("order verification denied telegram_user=%d", m.From.ID)
			response = orderRejected
			break
		}
		owner, claimed := b.state.Claims[order.Hash]
		conflict := claimed && owner != m.From.ID
		if userID := b.state.Bindings[id]; userID != 0 && userID != order.UserID {
			conflict = true
		}
		for telegramID, userID := range b.state.Bindings {
			if userID == order.UserID && telegramID != id {
				conflict = true
				break
			}
		}
		if conflict {
			log.Printf("order verification denied telegram_user=%d reason=association-conflict", m.From.ID)
			response = orderRejected
			break
		}
		b.state.Claims[order.Hash] = m.From.ID
		b.state.Bindings[id] = order.UserID
		// Persist ownership before asking Telegram to create an invitation.
		if err := b.state.save(b.cfg.StatePath); err != nil {
			return err
		}
		inviteURL, err := b.createInvitation(ctx, m.From.ID, order.UserID)
		if err != nil {
			return fmt.Errorf("cannot issue group invitation: %w", err)
		}
		response = fmt.Sprintf("订单验证通过！\n主站用户 ID：%d\nTelegram ID：%d\n已将当前 Telegram 账号与该主站用户关联。\n\n点击下方按钮申请加入 AiProxy 用户群，机器人仅批准当前 Telegram 账号。\n链接 10 分钟内有效，成功入群后失效；重新验证会替换旧链接。\n邀请链接：%s", order.UserID, m.From.ID, inviteURL)
		keyboard = map[string]any{"inline_keyboard": [][]map[string]string{{{"text": "申请加入 AiProxy 用户群", "url": inviteURL}}}}
		verifiedUserID = order.UserID
	}
	if err := b.state.save(b.cfg.StatePath); err != nil {
		return err
	}
	if verifiedUserID != 0 {
		log.Printf("order verification accepted telegram_user=%d site_user=%d", m.From.ID, verifiedUserID)
	}
	return b.reply(ctx, m.Chat.ID, response, keyboard, parseMode)
}

func main() {
	path := flag.String("config", "/etc/aiproxy-telegram-bot/config.json", "protected JSON configuration file")
	check := flag.Bool("check", false, "check database and bot identity without consuming updates")
	flag.Parse()
	if err := run(*path, *check); err != nil {
		log.Fatal(err)
	}
}

func run(path string, check bool) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return errors.New("cannot read bot configuration")
	}
	var cfg config
	if common.Unmarshal(data, &cfg) != nil || cfg.Token == "" || cfg.BotUsername == "" || !filepath.IsAbs(cfg.StatePath) {
		return errors.New("invalid bot configuration")
	}
	if cfg.GroupID >= 0 {
		return errors.New("group_id must be the negative Telegram group ID")
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	db, err := openDatabase(cfg.Driver, cfg.DSN)
	if err != nil {
		return err
	}
	pool, _ := db.DB()
	defer pool.Close()
	if _, err := paidOrder(ctx, db, "BOT_STARTUP_PROBE_NO_ORDER"); err != nil {
		return err
	}
	api := &telegram{base: "https://api.telegram.org/bot" + cfg.Token, client: &http.Client{Timeout: 45 * time.Second}}
	var me struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	}
	if err := api.call(ctx, "getMe", map[string]any{}, &me); err != nil {
		return err
	}
	if me.Username != cfg.BotUsername {
		return errors.New("bot identity does not match configuration")
	}
	var webhook struct {
		URL string `json:"url"`
	}
	if err := api.call(ctx, "getWebhookInfo", map[string]any{}, &webhook); err != nil {
		return err
	}
	if webhook.URL != "" {
		return errors.New("bot already has a webhook; remove it deliberately before polling")
	}
	var member struct {
		Status         string `json:"status"`
		CanInviteUsers bool   `json:"can_invite_users"`
	}
	if err := api.call(ctx, "getChatMember", map[string]any{"chat_id": cfg.GroupID, "user_id": me.ID}, &member); err != nil {
		return err
	}
	if member.Status != "administrator" || !member.CanInviteUsers {
		return errors.New("bot needs group administrator status with can_invite_users")
	}
	if check {
		log.Printf("database and Telegram identity checks passed bot=@%s", me.Username)
		return nil
	}
	lock, err := os.OpenFile(cfg.StatePath+".lock", os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return errors.New("cannot open process lock")
	}
	defer lock.Close()
	if syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return errors.New("another bot process holds the state lock")
	}
	s, err := loadState(cfg.StatePath)
	if err != nil {
		return err
	}
	b := &bot{cfg: cfg, db: db, state: s, api: api, now: time.Now}
	log.Printf("bot started username=@%s", me.Username)
	for ctx.Err() == nil {
		var updates []update
		err := api.call(ctx, "getUpdates", map[string]any{"offset": s.Offset, "timeout": 30, "limit": 50, "allowed_updates": []string{"message", "callback_query", "chat_join_request"}}, &updates)
		if err == nil {
			for _, u := range updates {
				if u.ID < s.Offset {
					continue
				}
				err = b.handle(ctx, u)
				var apiErr *apiError
				if errors.As(err, &apiErr) && (apiErr.Code == 400 || apiErr.Code == 403) {
					log.Printf("undeliverable Telegram reply status=%d", apiErr.Code)
					err = nil
				}
				if err != nil {
					break
				}
				s.Offset = u.ID + 1
				if err := s.save(cfg.StatePath); err != nil {
					return errors.New("cannot persist bot state; stopping")
				}
			}
		}
		if err != nil && ctx.Err() == nil {
			log.Printf("bot operation failed: %v", err)
			delay := 5 * time.Second
			var apiErr *apiError
			if errors.As(err, &apiErr) && apiErr.RetryAfter > 0 {
				delay = time.Duration(apiErr.RetryAfter) * time.Second
			}
			select {
			case <-ctx.Done():
			case <-time.After(delay):
			}
		}
	}
	return nil
}
