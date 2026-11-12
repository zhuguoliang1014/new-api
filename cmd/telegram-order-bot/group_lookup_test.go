package main

import (
	"context"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func groupLookupUpdate(t *testing.T, f *botFixture) update {
	t.Helper()
	var u update
	require.NoError(t, common.UnmarshalJsonStr(`{"update_id":70,"message":{"message_id":42,"message_thread_id":5,"from":{"id":900},"chat":{"id":-100001,"type":"supergroup"},"text":"@test_bot id","reply_to_message":{"message_id":40,"from":{"id":101},"chat":{"id":-100001,"type":"supergroup"},"text":"延迟很高"}}}`, &u))
	f.bot.state.Bindings["101"] = 273
	f.bot.state.Bindings["900"] = 999 // The requester is not the lookup target.
	return u
}

func TestGroupLookupRepliesToBoundUserAndPreservesState(t *testing.T) {
	for _, command := range []string{"@test_bot id", "id @test_bot", " \n@TEST_BOT\tID ", "/id@test_bot"} {
		t.Run(command, func(t *testing.T) {
			f := newBotFixture(t)
			u := groupLookupUpdate(t, f)
			u.Message.Text = command
			require.NoError(t, f.bot.state.save(f.bot.cfg.StatePath))
			saved, err := loadState(f.bot.cfg.StatePath)
			require.NoError(t, err)
			f.bot.state = saved // Existing associations remain queryable after a restart.
			// Query only the existing bot association, with no database access or state mutation.
			f.bot.db = nil
			before, err := common.Marshal(f.bot.state)
			require.NoError(t, err)
			require.NoError(t, f.bot.handle(context.Background(), u))
			require.Equal(t, []string{"/sendMessage"}, f.methods)
			require.Len(t, f.replies, 1)
			assert.Equal(t, "平台 ID：273", f.replies[0]["text"])
			assert.EqualValues(t, f.bot.cfg.GroupID, f.replies[0]["chat_id"])
			assert.EqualValues(t, 5, f.replies[0]["message_thread_id"])
			assert.EqualValues(t, 40, f.replies[0]["reply_parameters"].(map[string]any)["message_id"])
			assert.NotContains(t, f.replies[0], "parse_mode")
			after, err := common.Marshal(f.bot.state)
			require.NoError(t, err)
			assert.Equal(t, string(before), string(after))
		})
	}
}

func TestGroupLookupAuthorizationAndTargetIdentification(t *testing.T) {
	for _, test := range []struct {
		name   string
		change func(*botFixture, *message)
		want   string
	}{
		{"owner", func(f *botFixture, m *message) { f.memberStatus = "creator" }, "平台 ID：273"},
		{"member", func(f *botFixture, m *message) { f.memberStatus = "member" }, "平台 ID：273"},
		{"unbound-requester", func(f *botFixture, m *message) { delete(f.bot.state.Bindings, "900") }, "平台 ID：273"},

		{"wrong-group", func(f *botFixture, m *message) { m.Chat.ID-- }, ""},
		{"private", func(f *botFixture, m *message) { m.Chat.Type = "private" }, ""},
		{"channel", func(f *botFixture, m *message) { m.Chat.Type = "channel" }, ""},
		{"other-bot", func(f *botFixture, m *message) { m.Text = "@other_bot id" }, ""},
		{"no-mention", func(f *botFixture, m *message) { m.Text = "id" }, ""},
		{"incidental-text", func(f *botFixture, m *message) { m.Text = "查询 @test_bot id 273" }, ""},
		{"bot-requester", func(f *botFixture, m *message) { m.From.IsBot = true }, ""},
		{"anonymous-requester", func(f *botFixture, m *message) {
			m.SenderChat = &telegramChat{ID: m.Chat.ID, Type: "supergroup"}
			m.From = &telegramUser{ID: 1087968824, IsBot: true}
		}, "平台 ID：273"},
		{"anonymous-without-from", func(f *botFixture, m *message) {
			m.SenderChat = &telegramChat{ID: m.Chat.ID, Type: "supergroup"}
			m.From = nil
		}, "平台 ID：273"},
		{"anonymous-no-reply", func(f *botFixture, m *message) {
			m.SenderChat = &telegramChat{ID: m.Chat.ID}
			m.From = nil
			m.ReplyTo = nil
		}, "请回复需要查询的用户消息"},
		{"external-sender-chat", func(f *botFixture, m *message) {
			m.SenderChat = &telegramChat{ID: m.Chat.ID - 1, Type: "channel"}
		}, ""},
		{"anonymous-target-from-anonymous", func(f *botFixture, m *message) {
			m.SenderChat = &telegramChat{ID: m.Chat.ID}
			m.From = nil
			m.ReplyTo.SenderChat = &telegramChat{ID: m.Chat.ID}
		}, "无法识别"},
		{"no-requester", func(f *botFixture, m *message) { m.From = nil }, ""},
		{"no-reply", func(f *botFixture, m *message) { m.ReplyTo = nil }, "请回复需要查询的用户消息"},
		{"unknown-binding", func(f *botFixture, m *message) { delete(f.bot.state.Bindings, "101") }, "尚未在机器人中绑定"},
		{"no-target-sender", func(f *botFixture, m *message) { m.ReplyTo.From = nil }, "无法识别"},
		{"bot-target", func(f *botFixture, m *message) { m.ReplyTo.From.IsBot = true }, "无法识别"},
		{"anonymous-target", func(f *botFixture, m *message) {
			m.ReplyTo.SenderChat = &telegramChat{ID: m.Chat.ID}
		}, "无法识别"},
		{"external-target", func(f *botFixture, m *message) { m.ReplyTo.Chat.ID-- }, "无法识别"},
		{"zero-target", func(f *botFixture, m *message) { m.ReplyTo.From.ID = 0 }, "无法识别"},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newBotFixture(t)
			u := groupLookupUpdate(t, f)
			test.change(f, u.Message)
			require.NoError(t, f.bot.handle(context.Background(), u))
			if test.want == "" {
				assert.Empty(t, f.replies)
				return
			}
			require.Len(t, f.replies, 1)
			assert.Contains(t, f.replies[0]["text"], test.want)
		})
	}
}

func TestGroupLookupDoesNotRequireAdministratorLookup(t *testing.T) {
	f := newBotFixture(t)
	u := groupLookupUpdate(t, f)
	f.memberStatus = "member"
	f.failMethod = "/getChatMember"
	require.NoError(t, f.bot.handle(context.Background(), u))
	require.Len(t, f.replies, 1)
	assert.Equal(t, "平台 ID：273", f.replies[0]["text"])
	assert.Equal(t, []string{"/sendMessage"}, f.methods)
}

func TestGroupLookupRateLimitsAndTopics(t *testing.T) {
	f := newBotFixture(t)
	u := groupLookupUpdate(t, f)
	u.Message.ThreadID = 0
	u.Message.Chat.Type = "group"
	for range 7 {
		require.NoError(t, f.bot.handle(context.Background(), u))
	}
	require.Len(t, f.replies, 6)
	assert.NotContains(t, f.replies[0], "message_thread_id")
	f.now = f.now.Add(time.Minute)
	require.NoError(t, f.bot.handle(context.Background(), u))
	require.Len(t, f.replies, 7)
	f.bot.groupLookupGlobal = window{Start: f.now.Unix(), Count: 60}
	u.Message.From.ID++
	require.NoError(t, f.bot.handle(context.Background(), u))
	require.Len(t, f.replies, 7)
}

func TestGroupLookupAnonymousAdministratorsShareLimit(t *testing.T) {
	f := newBotFixture(t)
	u := groupLookupUpdate(t, f)
	u.Message.SenderChat = &telegramChat{ID: u.Message.Chat.ID, Type: "supergroup"}
	u.Message.From = &telegramUser{ID: 1087968824, IsBot: true}
	for range 6 {
		require.NoError(t, f.bot.handle(context.Background(), u))
	}
	u.Message.From = nil
	require.NoError(t, f.bot.handle(context.Background(), u))
	require.Len(t, f.replies, 6)
	// Personal requests retain their own allowance even after anonymous queries reach the limit.
	u.Message.SenderChat = nil
	u.Message.From = &telegramUser{ID: 900}
	require.NoError(t, f.bot.handle(context.Background(), u))
	require.Len(t, f.replies, 7)
	f.now = f.now.Add(time.Minute)
	u.Message.SenderChat = &telegramChat{ID: u.Message.Chat.ID}
	u.Message.From = nil
	require.NoError(t, f.bot.handle(context.Background(), u))
	require.Len(t, f.replies, 8)
}
