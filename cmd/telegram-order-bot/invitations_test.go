package main

import (
	"context"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func joinUpdate(t *testing.T, updateID, groupID, userID int64, inviteURL string) update {
	t.Helper()
	raw, err := common.Marshal(map[string]any{"update_id": updateID, "chat_join_request": map[string]any{"chat": map[string]any{"id": groupID}, "from": map[string]any{"id": userID}, "invite_link": map[string]any{"invite_link": inviteURL}}})
	require.NoError(t, err)
	var u update
	require.NoError(t, common.Unmarshal(raw, &u))
	return u
}

func TestInvitationLifecycle(t *testing.T) {
	f := newBotFixture(t)
	f.send(t, 101, "/join")
	f.send(t, 101, "HUP1000000000001")
	grant := *f.bot.state.Invites["101"]
	require.Equal(t, f.now.Unix()+600, grant.ExpiresAt)
	index := slices.Index(f.methods, "/createChatInviteLink")
	require.GreaterOrEqual(t, index, 0)
	require.Equal(t, true, f.requests[index]["creates_join_request"])
	require.NotContains(t, f.requests[index], "member_limit")
	require.EqualValues(t, f.bot.cfg.GroupID, f.requests[index]["chat_id"])
	saved, err := loadState(f.bot.cfg.StatePath)
	require.NoError(t, err)
	f.bot.state = saved
	// Leaking the URL never authorizes another Telegram account.
	require.NoError(t, f.bot.handle(context.Background(), joinUpdate(t, 10, f.bot.cfg.GroupID, 102, grant.URL)))
	require.Contains(t, f.methods, "/declineChatJoinRequest")
	require.NotContains(t, f.methods, "/approveChatJoinRequest")
	require.Zero(t, f.bot.state.Invites["101"].ConsumedBy)
	// Only the owner is approved, and the link is revoked afterward.
	u := joinUpdate(t, 11, f.bot.cfg.GroupID, 101, grant.URL)
	require.NoError(t, f.bot.handle(context.Background(), u))
	approved := slices.Index(f.methods, "/approveChatJoinRequest")
	revoked := slices.Index(f.methods, "/revokeChatInviteLink")
	require.Greater(t, revoked, approved)
	require.True(t, f.bot.state.Invites["101"].Approved)
	require.EqualValues(t, 11, f.bot.state.Invites["101"].ConsumedBy)
	saved, err = loadState(f.bot.cfg.StatePath)
	require.NoError(t, err)
	f.bot.state = saved
	require.NoError(t, f.bot.handle(context.Background(), u)) // Redelivery cannot approve twice.
	require.Equal(t, 1, countMethod(f.methods, "/approveChatJoinRequest"))
	require.NoError(t, f.bot.handle(context.Background(), joinUpdate(t, 12, f.bot.cfg.GroupID, 101, grant.URL)))
	require.Equal(t, 1, countMethod(f.methods, "/approveChatJoinRequest"))
	f.send(t, 101, "/join")
	f.send(t, 101, "HUP1000000000001")
	require.NotEqual(t, grant.URL, f.bot.state.Invites["101"].URL)
	require.Zero(t, f.bot.state.Invites["101"].ConsumedBy)
}

func countMethod(methods []string, target string) int {
	count := 0
	for _, method := range methods {
		if method == target {
			count++
		}
	}
	return count
}

func TestInvitationRejectsExpiryAndBypass(t *testing.T) {
	for _, test := range []string{"expired", "wrong-group", "unknown-link", "missing-link", "bot", "missing-binding", "wrong-binding", "invalid-update"} {
		t.Run(test, func(t *testing.T) {
			f := newBotFixture(t)
			f.send(t, 101, "/join")
			f.send(t, 101, "HUP1000000000001")
			grant := f.bot.state.Invites["101"]
			u := joinUpdate(t, 10, f.bot.cfg.GroupID, 101, grant.URL)
			switch test {
			case "expired":
				f.now = f.now.Add(600 * time.Second)
			case "wrong-group":
				u.JoinRequest.Chat.ID--
			case "unknown-link":
				u.JoinRequest.InviteLink.URL = "https://t.me/+UNKNOWN"
			case "missing-link":
				u.JoinRequest.InviteLink = nil
			case "bot":
				u.JoinRequest.From.IsBot = true
			case "missing-binding":
				delete(f.bot.state.Bindings, "101")
			case "wrong-binding":
				f.bot.state.Bindings["101"] = 4
			case "invalid-update":
				u.ID = 0
			}
			require.NoError(t, f.bot.handle(context.Background(), u))
			require.NotContains(t, f.methods, "/approveChatJoinRequest")
		})
	}
}

func TestInvitationStateFailureCannotApproveOnRetry(t *testing.T) {
	f := newBotFixture(t)
	f.send(t, 101, "/join")
	f.send(t, 101, "HUP1000000000001")
	u := joinUpdate(t, 10, f.bot.cfg.GroupID, 101, f.bot.state.Invites["101"].URL)
	path := f.bot.cfg.StatePath
	f.bot.cfg.StatePath = filepath.Join(t.TempDir(), "missing", "state.json")
	for range 2 {
		require.Error(t, f.bot.handle(context.Background(), u))
	}
	require.NotContains(t, f.methods, "/approveChatJoinRequest")
	f.bot.cfg.StatePath = path
	f.failMethod = "/approveChatJoinRequest"
	require.Error(t, f.bot.handle(context.Background(), u))
	saved, err := loadState(path)
	require.NoError(t, err)
	require.EqualValues(t, 10, saved.Invites["101"].ConsumedBy)
	require.False(t, saved.Invites["101"].Approved)
	f.bot.state = saved
	// A different event cannot reuse a reserved grant after a restart.
	require.NoError(t, f.bot.handle(context.Background(), joinUpdate(t, 11, f.bot.cfg.GroupID, 101, saved.Invites["101"].URL)))
	f.failMethod = ""
	f.memberStatus = "member" // Previous approval succeeded remotely, but its response was lost.
	before := countMethod(f.methods, "/approveChatJoinRequest")
	require.NoError(t, f.bot.handle(context.Background(), u))
	require.Equal(t, before, countMethod(f.methods, "/approveChatJoinRequest"))
	require.True(t, f.bot.state.Invites["101"].Approved)
	require.Contains(t, f.methods, "/revokeChatInviteLink")
}

func TestInvitationCreationFailureHasNoFallback(t *testing.T) {
	f := newBotFixture(t)
	f.send(t, 101, "/join")
	f.failMethod = "/createChatInviteLink"
	before := len(f.replies)
	m := &message{From: &telegramUser{ID: 101}, Text: "HUP1000000000001"}
	m.Chat.ID, m.Chat.Type = 101, "private"
	require.Error(t, f.bot.handle(context.Background(), update{Message: m}))
	require.Len(t, f.replies, before)
	require.Empty(t, f.bot.state.Invites)
	f.failMethod = ""
	require.NoError(t, f.bot.handle(context.Background(), update{Message: m}))
	first := f.bot.state.Invites["101"].URL
	f.failMethod = "/revokeChatInviteLink"
	before = countMethod(f.methods, "/createChatInviteLink")
	require.Error(t, f.bot.handle(context.Background(), update{Message: m}))
	require.Equal(t, before, countMethod(f.methods, "/createChatInviteLink"))
	require.Equal(t, first, f.bot.state.Invites["101"].URL)
}

func TestInvitationResponseMustEnforceApprovalAndExpiry(t *testing.T) {
	for _, kind := range []string{"direct", "expiry", "url"} {
		t.Run(kind, func(t *testing.T) {
			f := newBotFixture(t)
			f.send(t, 101, "/join")
			f.invalidInvite = kind
			before := len(f.replies)
			m := &message{From: &telegramUser{ID: 101}, Text: "HUP1000000000001"}
			m.Chat.ID, m.Chat.Type = 101, "private"
			require.Error(t, f.bot.handle(context.Background(), update{Message: m}))
			require.Len(t, f.replies, before)
			require.Empty(t, f.bot.state.Invites)
		})
	}
}
