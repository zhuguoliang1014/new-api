package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strconv"
)

// A link requests approval; possession of the URL alone never grants membership.
func (b *bot) createInvitation(ctx context.Context, telegramID int64, siteUserID int) (string, error) {
	if b.cfg.GroupID >= 0 {
		return "", errors.New("group invitation is not configured")
	}
	id := strconv.FormatInt(telegramID, 10)
	if previous := b.state.Invites[id]; previous != nil {
		if err := b.revokeInvitation(ctx, previous.URL); err != nil {
			return "", err
		}
		delete(b.state.Invites, id)
		if err := b.state.save(b.cfg.StatePath); err != nil {
			return "", err
		}
	}
	expires := b.now().Unix() + 600
	var created struct {
		URL                string `json:"invite_link"`
		ExpireDate         int64  `json:"expire_date"`
		CreatesJoinRequest bool   `json:"creates_join_request"`
		Revoked            bool   `json:"is_revoked"`
	}
	err := b.api.call(ctx, "createChatInviteLink", map[string]any{
		"chat_id": b.cfg.GroupID, "name": fmt.Sprintf("order-%d", telegramID),
		"expire_date": expires, "creates_join_request": true,
	}, &created)
	if err != nil {
		return "", err
	}
	if !validInviteURL(created.URL) || !created.CreatesJoinRequest || created.Revoked || created.ExpireDate != expires {
		return "", errors.New("Telegram returned an invalid invitation")
	}
	b.state.Invites[id] = &invitation{URL: created.URL, ExpiresAt: expires, SiteUserID: siteUserID}
	if err := b.state.save(b.cfg.StatePath); err != nil {
		// An orphan remains approval-only and expires on Telegram after ten minutes.
		return "", err
	}
	return created.URL, nil
}

func (b *bot) handleJoinRequest(ctx context.Context, u update) error {
	r := u.JoinRequest
	if r.Chat.ID != b.cfg.GroupID || r.From.ID <= 0 || r.InviteLink == nil {
		return nil
	}
	var owner string
	var grant *invitation
	for id, invite := range b.state.Invites {
		if invite.URL == r.InviteLink.URL {
			owner, grant = id, invite
			break
		}
	}
	if grant == nil {
		return nil // Other administrators' links are outside this bot's approval grants.
	}
	id := strconv.FormatInt(r.From.ID, 10)
	if u.ID <= 0 || owner != id || r.From.IsBot || b.state.Bindings[id] != grant.SiteUserID ||
		grant.ExpiresAt <= b.now().Unix() || (grant.ConsumedBy != 0 && grant.ConsumedBy != u.ID) {
		log.Printf("group join denied telegram_user=%d", r.From.ID)
		return b.api.call(ctx, "declineChatJoinRequest", map[string]any{"chat_id": b.cfg.GroupID, "user_id": r.From.ID}, nil)
	}
	if grant.ConsumedBy == 0 {
		grant.ConsumedBy = u.ID
	}
	// Save on every retry: an earlier failed write may have changed only memory.
	if err := b.state.save(b.cfg.StatePath); err != nil {
		return err
	}
	if !grant.Approved {
		// Resolve an ambiguous approval after a network failure or process restart.
		var member struct {
			Status   string `json:"status"`
			IsMember bool   `json:"is_member"`
		}
		if err := b.api.call(ctx, "getChatMember", map[string]any{"chat_id": b.cfg.GroupID, "user_id": r.From.ID}, &member); err != nil {
			return err
		}
		present := member.Status == "member" || member.Status == "administrator" || member.Status == "creator" || (member.Status == "restricted" && member.IsMember)
		if !present {
			if err := b.api.call(ctx, "approveChatJoinRequest", map[string]any{"chat_id": b.cfg.GroupID, "user_id": r.From.ID}, nil); err != nil {
				return err
			}
		}
		grant.Approved = true
		if err := b.state.save(b.cfg.StatePath); err != nil {
			return err
		}
		log.Printf("group join approved telegram_user=%d site_user=%d", r.From.ID, grant.SiteUserID)
	}
	return b.revokeInvitation(ctx, grant.URL)
}

func (b *bot) revokeInvitation(ctx context.Context, inviteURL string) error {
	err := b.api.call(ctx, "revokeChatInviteLink", map[string]any{"chat_id": b.cfg.GroupID, "invite_link": inviteURL}, nil)
	var apiErr *apiError
	if errors.As(err, &apiErr) && apiErr.InviteInactive {
		return nil
	}
	return err
}
