package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"
)

func (b *bot) isGroupLookup(text string) bool {
	fields := strings.Fields(text)
	mention := "@" + b.cfg.BotUsername
	return len(fields) == 1 && strings.EqualFold(fields[0], "/id"+mention) ||
		len(fields) == 2 && (strings.EqualFold(fields[0], mention) && strings.EqualFold(fields[1], "id") ||
			strings.EqualFold(fields[0], "id") && strings.EqualFold(fields[1], mention))
}

func (b *bot) handleGroupLookup(ctx context.Context, m *message) error {
	if m.Chat.ID != b.cfg.GroupID || m.ID <= 0 || !b.isGroupLookup(m.Text) {
		return nil
	}
	var requesterID int64
	if m.SenderChat != nil {
		// Anonymous administrators send as this group; the compatibility From is not a real user.
		if m.SenderChat.ID != m.Chat.ID {
			return nil
		}
		requesterID = m.SenderChat.ID
	} else {
		if m.From == nil || m.From.ID <= 0 || m.From.IsBot {
			return nil
		}
		requesterID = m.From.ID
	}
	// Keep group queries separate from private order sessions and their durable limits.
	now := b.now().Unix()
	for id, limit := range b.groupLookupUsers {
		if now >= limit.Start+60 {
			delete(b.groupLookupUsers, id)
		}
	}
	limit := b.groupLookupUsers[requesterID]
	if !limit.allow(now, 60, 6) || !b.groupLookupGlobal.allow(now, 60, 60) {
		return nil
	}
	if b.groupLookupUsers == nil {
		b.groupLookupUsers = make(map[int64]window)
	}
	b.groupLookupUsers[requesterID] = limit

	response := "请回复需要查询的用户消息，并发送 @" + b.cfg.BotUsername + " id。"
	replyID := m.ID
	if target := m.ReplyTo; target != nil {
		if target.Chat.ID != m.Chat.ID || target.ID <= 0 || target.SenderChat != nil ||
			target.From == nil || target.From.ID <= 0 || target.From.IsBot {
			response = "无法识别这条消息对应的个人账号，请回复该用户以个人身份发送的群消息。"
		} else {
			replyID = target.ID
			if siteID := b.state.Bindings[strconv.FormatInt(target.From.ID, 10)]; siteID > 0 {
				response = fmt.Sprintf("平台 ID：%d", siteID)
			} else {
				response = "该用户尚未在机器人中绑定平台账号，请先私聊 @" + b.cfg.BotUsername + " 完成订单验证。"
			}
		}
	}
	payload := map[string]any{
		"chat_id": m.Chat.ID, "text": response, "protect_content": true,
		"link_preview_options": map[string]bool{"is_disabled": true},
		"reply_parameters":     map[string]any{"message_id": replyID},
	}
	if m.ThreadID > 0 {
		payload["message_thread_id"] = m.ThreadID
	}
	return b.api.call(ctx, "sendMessage", payload, nil)
}
