package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type orderFixture struct {
	ID      int    `gorm:"primaryKey"`
	TradeNo string `gorm:"uniqueIndex;size:255"`
	UserID  int
	Status  string
}

type userFixture struct {
	ID        int `gorm:"primaryKey"`
	Status    int
	DeletedAt *time.Time
	Quota     int // Sentinel: verification must never change balances.
}

func orderDatabase(t *testing.T, driver, dsn string) *gorm.DB {
	t.Helper()
	db, err := openDatabase(driver, dsn)
	require.NoError(t, err)
	pool, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, pool.Close()) })
	// Only use dedicated test databases; these fixtures have no production migrations.
	for _, table := range []string{"subscription_orders", "top_ups", "users"} {
		require.NoError(t, db.Migrator().DropTable(table))
	}
	require.NoError(t, db.Table("users").AutoMigrate(&userFixture{}))
	for _, table := range []string{"subscription_orders", "top_ups"} {
		require.NoError(t, db.Table(table).AutoMigrate(&orderFixture{}))
	}
	deleted := time.Now()
	require.NoError(t, db.Table("users").Create(&[]userFixture{{ID: 1, Status: 1, Quota: 123456}, {ID: 2, Status: 2, Quota: 50}, {ID: 3, Status: 1, DeletedAt: &deleted, Quota: 60}, {ID: 4, Status: 1, Quota: 70}}).Error)
	require.NoError(t, db.Table("top_ups").Create(&[]orderFixture{
		{ID: 1, TradeNo: "HUP1000000000001", UserID: 1, Status: "success"},
		{ID: 2, TradeNo: "PENDING000001", UserID: 1, Status: "pending"},
		{ID: 3, TradeNo: "EXPIRED000001", UserID: 1, Status: "expired"},
		{ID: 4, TradeNo: "CANCELED00001", UserID: 1, Status: "canceled"},
		{ID: 5, TradeNo: "REFUNDED00001", UserID: 1, Status: "refunded"},
		{ID: 6, TradeNo: "DISABLED00001", UserID: 2, Status: "success"},
		{ID: 7, TradeNo: "DELETED000001", UserID: 3, Status: "success"},
		{ID: 8, TradeNo: "MISSINGUSER01", UserID: 99, Status: "success"},
		{ID: 9, TradeNo: "HUPS100000000001", UserID: 1, Status: "success"},
		{ID: 10, TradeNo: "MIRROR000001", UserID: 1, Status: "success"},
	}).Error)
	require.NoError(t, db.Table("subscription_orders").Create(&[]orderFixture{
		{ID: 1, TradeNo: "HUPS100000000001", UserID: 1, Status: "success"},
		{ID: 2, TradeNo: "MIRROR000001", UserID: 1, Status: "refunded"},
		{ID: 3, TradeNo: "SUBONLY000001", UserID: 4, Status: "success"},
	}).Error)
	return db
}

func TestPaidOrderDatabaseMatrix(t *testing.T) {
	drivers := []struct{ driver, dsn string }{{"sqlite", filepath.Join(t.TempDir(), "orders.db")}}
	for _, spec := range []struct{ driver, env string }{{"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		if dsn := os.Getenv(spec.env); dsn != "" {
			drivers = append(drivers, struct{ driver, dsn string }{spec.driver, dsn})
		} else {
			t.Logf("%s not configured; full matrix requires %s", spec.driver, spec.env)
		}
	}
	for _, spec := range drivers {
		t.Run(spec.driver, func(t *testing.T) {
			db := orderDatabase(t, spec.driver, spec.dsn)
			versionSQL := "SELECT version()"
			if spec.driver == "sqlite" {
				versionSQL = "SELECT sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionSQL).Scan(&version).Error)
			t.Logf("database version: %s", version)
			ctx := context.Background()
			for _, number := range []string{"HUP1000000000001", "HUPS100000000001", "SUBONLY000001"} {
				hash, err := paidOrder(ctx, db, number)
				require.NoError(t, err)
				require.NotNil(t, hash)
				require.Len(t, hash.Hash, 64)
				require.Positive(t, hash.UserID)
			}
			for _, number := range []string{"PENDING000001", "EXPIRED000001", "CANCELED00001", "REFUNDED00001", "DISABLED00001", "DELETED000001", "MISSINGUSER01", "MIRROR000001", "NOORDER000001", "hup1000000000001", "HUP1000000000001 ", "' OR 1=1 --"} {
				hash, err := paidOrder(ctx, db, number)
				require.NoError(t, err)
				require.Nil(t, hash, number)
			}
			canceled, cancel := context.WithCancel(ctx)
			cancel()
			_, err := paidOrder(canceled, db, "HUP1000000000001")
			require.Error(t, err)
			var users []userFixture
			require.NoError(t, db.Table("users").Order("id").Find(&users).Error)
			require.Equal(t, []int{123456, 50, 60}, []int{users[0].Quota, users[1].Quota, users[2].Quota})
			var total int64
			require.NoError(t, db.Table("top_ups").Count(&total).Error)
			require.EqualValues(t, 10, total)
			require.NoError(t, db.Migrator().DropTable("subscription_orders"))
			hash, err := paidOrder(ctx, db, "HUP1000000000001")
			require.Error(t, err)
			require.Nil(t, hash) // Database errors must never fall through to success.
		})
	}
}

type botFixture struct {
	bot            *bot
	replies        []map[string]any
	methods        []string
	now            time.Time
	httpCode       int
	requests       []map[string]any
	inviteSequence int
	memberStatus   string
	failMethod     string
	invalidInvite  string
}

func newBotFixture(t *testing.T) *botFixture {
	t.Helper()
	f := &botFixture{now: time.Unix(1793280000, 0)}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.methods = append(f.methods, r.URL.Path)
		var request map[string]any
		require.NoError(t, common.DecodeJson(r.Body, &request))
		f.requests = append(f.requests, request)
		if r.URL.Path == "/sendMessage" {
			f.replies = append(f.replies, request)
		}
		w.Header().Set("Content-Type", "application/json")
		if f.httpCode != 0 || r.URL.Path == f.failMethod {
			code := f.httpCode
			if code == 0 {
				code = 429
			}
			w.WriteHeader(code)
			_, _ = w.Write([]byte(`{"ok":false,"error_code":429,"parameters":{"retry_after":30}}`))
			return
		}
		switch r.URL.Path {
		case "/createChatInviteLink":
			f.inviteSequence++
			created := map[string]any{"invite_link": "https://t.me/+TEST_INVITE_" + strconv.Itoa(f.inviteSequence), "expire_date": request["expire_date"], "creates_join_request": true}
			switch f.invalidInvite {
			case "direct":
				created["creates_join_request"] = false
			case "expiry":
				created["expire_date"] = f.now.Unix() + 3600
			case "url":
				created["invite_link"] = "https://example.com/+INVALID"
			}
			body, err := common.Marshal(map[string]any{"ok": true, "result": created})
			require.NoError(t, err)
			_, _ = w.Write(body)
		case "/getChatMember":
			status := f.memberStatus
			if status == "" {
				status = "left"
			}
			body, err := common.Marshal(map[string]any{"ok": true, "result": map[string]any{"status": status}})
			require.NoError(t, err)
			_, _ = w.Write(body)
		default:
			_, _ = w.Write([]byte(`{"ok":true,"result":{"username":"test_bot"}}`))
		}
	}))
	t.Cleanup(server.Close)
	path := filepath.Join(t.TempDir(), "state.json")
	s, err := loadState(path)
	require.NoError(t, err)
	f.bot = &bot{
		cfg: config{BotUsername: "test_bot", GroupID: -100001, StatePath: path},
		db:  orderDatabase(t, "sqlite", filepath.Join(t.TempDir(), "orders.db")), state: s,
		api: &telegram{base: server.URL, client: server.Client()}, now: func() time.Time { return f.now },
	}
	return f
}

func (f *botFixture) send(t *testing.T, user int64, text string) string {
	t.Helper()
	m := &message{From: &telegramUser{ID: user}, Text: text}
	m.Chat.ID, m.Chat.Type = user, "private"
	before := len(f.replies)
	require.NoError(t, f.bot.handle(context.Background(), update{Message: m}))
	if len(f.replies) == before {
		return ""
	}
	return f.replies[len(f.replies)-1]["text"].(string)
}

func TestBotOrderConversation(t *testing.T) {
	f := newBotFixture(t)
	require.Contains(t, f.send(t, 101, "/start"), "欢迎")
	assert.NotContains(t, f.replies[len(f.replies)-1], "parse_mode")
	require.Contains(t, f.send(t, 101, "HUP1000000000001"), "/join")
	require.NotContains(t, f.send(t, 101, "/join"), "https://t.me/+TEST_INVITE_")
	assert.Equal(t, "HTML", f.replies[len(f.replies)-1]["parse_mode"])
	assert.Contains(t, f.replies[len(f.replies)-1]["text"], `<a href="https://92ai.asia/orders">我的订单</a>」，复制订单号后发送给我。`)
	require.Equal(t, orderRejected, f.send(t, 101, "PENDING000001"))
	assert.NotContains(t, f.replies[len(f.replies)-1], "parse_mode")
	require.Equal(t, orderRejected, f.send(t, 101, "' OR 1=1 --"))
	require.Contains(t, f.send(t, 101, "HUP1000000000001"), "https://t.me/+TEST_INVITE_")
	require.Equal(t, true, f.replies[len(f.replies)-1]["protect_content"])
	saved, err := loadState(f.bot.cfg.StatePath)
	require.NoError(t, err)
	f.bot.state = saved // Simulate a restart; the claim must survive.
	f.send(t, 102, "/join")
	require.Equal(t, orderRejected, f.send(t, 102, "HUP1000000000001"))
	f.send(t, 101, "/join")
	require.Contains(t, f.send(t, 101, "HUP1000000000001"), "https://t.me/+TEST_INVITE_")
	f.send(t, 103, "/join")
	require.Contains(t, f.send(t, 103, "SUBONLY000001"), "https://t.me/+TEST_INVITE_")
	f.send(t, 104, "/join")
	f.now = f.now.Add(601 * time.Second)
	require.Contains(t, f.send(t, 104, "SUBONLY000001"), "/join")
	f.send(t, 104, "/join")
	f.send(t, 104, "/cancel")
	require.Contains(t, f.send(t, 104, "SUBONLY000001"), "/join")
	data, err := os.ReadFile(f.bot.cfg.StatePath)
	require.NoError(t, err)
	require.NotContains(t, string(data), "HUP1000000000001")
	require.Contains(t, string(data), "https://t.me/+TEST_INVITE_") // Protected state retains the exact approval grant.
}

func TestBotThrottlingAndPrivateChatIsolation(t *testing.T) {
	f := newBotFixture(t)
	f.send(t, 201, "/join")
	for range 5 {
		require.Equal(t, orderRejected, f.send(t, 201, "INVALID00001"))
	}
	f.send(t, 201, "/join")
	saved, err := loadState(f.bot.cfg.StatePath)
	require.NoError(t, err)
	f.bot.state = saved
	require.Contains(t, f.send(t, 201, "HUP1000000000001"), "频繁")
	f.now = f.now.Add(601 * time.Second)
	f.send(t, 201, "/join")
	require.Contains(t, f.send(t, 201, "HUP1000000000001"), "https://t.me/+TEST_INVITE_")
	before := len(f.replies)
	for _, chatType := range []string{"group", "supergroup", "channel"} {
		m := &message{From: &telegramUser{ID: 201}, Text: "HUP1000000000001"}
		m.Chat.ID, m.Chat.Type = -10001, chatType
		require.NoError(t, f.bot.handle(context.Background(), update{Message: m}))
	}
	m := &message{From: &telegramUser{ID: 201}, Text: "/join"}
	m.Chat.ID, m.Chat.Type = 202, "private"
	require.NoError(t, f.bot.handle(context.Background(), update{Message: m}))
	require.Len(t, f.replies, before)
	f.send(t, 203, "/join")
	f.bot.state.Global = window{Start: f.now.Unix(), Count: 120}
	require.Contains(t, f.send(t, 203, "SUBONLY000001"), "频繁")
}

func TestBotAccountAssociations(t *testing.T) {
	f := newBotFixture(t)
	f.send(t, 101, "/join")
	response := f.send(t, 101, "HUP1000000000001")
	require.Contains(t, response, "主站用户 ID：1")
	require.Contains(t, response, "Telegram ID：101")
	require.Equal(t, 1, f.bot.state.Bindings["101"])
	f.send(t, 102, "/join")
	// A different paid order from the same account cannot bind a second Telegram user.
	require.Equal(t, orderRejected, f.send(t, 102, "HUPS100000000001"))
	require.NotContains(t, f.bot.state.Bindings, "102")
	// An existing Telegram association cannot be silently moved to another site account.
	require.Equal(t, orderRejected, f.send(t, 101, "SUBONLY000001"))
	require.Equal(t, 1, f.bot.state.Bindings["101"])
	f.send(t, 103, "/join")
	require.Contains(t, f.send(t, 103, "SUBONLY000001"), "主站用户 ID：4")
	saved, err := loadState(f.bot.cfg.StatePath)
	require.NoError(t, err)
	f.bot.state = saved
	require.Equal(t, map[string]int{"101": 1, "103": 4}, saved.Bindings)
	require.Contains(t, f.send(t, 101, "/start"), "当前已关联主站用户 ID：1")
	f.send(t, 102, "/join")
	require.Equal(t, orderRejected, f.send(t, 102, "HUPS100000000001"))
}

func TestBotCallbackUsesActorAndFailsClosed(t *testing.T) {
	f := newBotFixture(t)
	var u update
	require.NoError(t, common.UnmarshalJsonStr(`{"update_id":42,"callback_query":{"id":"callback","from":{"id":301},"data":"join","message":{"from":{"id":999,"is_bot":true},"chat":{"id":301,"type":"private"}}}}`, &u))
	require.NoError(t, f.bot.handle(context.Background(), u))
	require.EqualValues(t, 301, f.replies[len(f.replies)-1]["chat_id"])
	require.Equal(t, orderPrompt, f.replies[len(f.replies)-1]["text"])
	assert.Equal(t, "HTML", f.replies[len(f.replies)-1]["parse_mode"])
	require.Contains(t, f.methods, "/answerCallbackQuery")
	u.Callback.From.ID = 302
	before := len(f.replies)
	require.NoError(t, f.bot.handle(context.Background(), u))
	require.Len(t, f.replies, before)
	require.NoError(t, f.bot.db.Migrator().DropTable("subscription_orders"))
	require.NotContains(t, f.send(t, 301, "HUP1000000000001"), "https://t.me/+TEST_INVITE_")
	// No invitation may leave the process if its durable state cannot be written.
	f.bot.cfg.StatePath = filepath.Join(t.TempDir(), "missing", "state.json")
	m := &message{From: &telegramUser{ID: 303}, Text: "/join"}
	m.Chat.ID, m.Chat.Type = 303, "private"
	before = len(f.replies)
	require.Error(t, f.bot.handle(context.Background(), update{Message: m}))
	require.Len(t, f.replies, before)
}

func TestStateCorruptionAndTelegramProtocol(t *testing.T) {
	f := newBotFixture(t)
	f.bot.state.Offset = 12345
	require.NoError(t, f.bot.state.save(f.bot.cfg.StatePath))
	saved, err := loadState(f.bot.cfg.StatePath)
	require.NoError(t, err)
	require.EqualValues(t, 12345, saved.Offset)
	info, err := os.Stat(f.bot.cfg.StatePath)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0600), info.Mode().Perm())
	require.NoError(t, os.WriteFile(f.bot.cfg.StatePath, []byte(`{"version":1,"claims":{"existing-order-hash":101},"users":{},"offset":12345}`), 0600))
	saved, err = loadState(f.bot.cfg.StatePath)
	require.NoError(t, err)
	require.Equal(t, 3, saved.Version)
	require.EqualValues(t, 101, saved.Claims["existing-order-hash"])
	require.Empty(t, saved.Bindings)
	require.NoError(t, os.WriteFile(f.bot.cfg.StatePath, []byte(`{"version":99}`), 0600))
	_, err = loadState(f.bot.cfg.StatePath)
	require.Error(t, err)
	for _, corrupt := range []string{
		`{"version":2,"claims":{},"users":{}}`,
		`{"version":2,"claims":{},"users":{"101":null},"bindings":{}}`,
		`{"version":2,"claims":{},"users":{},"bindings":{"101":1,"102":1}}`,
	} {
		require.NoError(t, os.WriteFile(f.bot.cfg.StatePath, []byte(corrupt), 0600))
		_, err = loadState(f.bot.cfg.StatePath)
		require.Error(t, err)
	}
	var me struct{ Username string }
	require.NoError(t, f.bot.api.call(context.Background(), "getMe", map[string]any{}, &me))
	require.Equal(t, "test_bot", me.Username)
	f.httpCode = 429
	err = f.bot.api.call(context.Background(), "getMe", map[string]any{}, nil)
	var apiErr *apiError
	require.True(t, errors.As(err, &apiErr))
	require.Equal(t, 30, apiErr.RetryAfter)
	f.bot.api.base = "http://127.0.0.1:0/botSECRET_TOKEN"
	err = f.bot.api.call(context.Background(), "getMe", map[string]any{}, nil)
	require.Error(t, err)
	require.NotContains(t, err.Error(), "SECRET_TOKEN")
	for i := range 13 {
		f.bot.state.Users[strconv.Itoa(i)] = &conversation{Seen: f.now.Unix() - 90000}
	}
	f.bot.api.base = strings.TrimSuffix(f.bot.api.base, "/botSECRET_TOKEN")
	// A command to another bot is ignored, but stale conversation entries are cleaned.
	require.Empty(t, f.send(t, 401, "/join@other_bot"))
	require.Len(t, f.bot.state.Users, 1)
}
