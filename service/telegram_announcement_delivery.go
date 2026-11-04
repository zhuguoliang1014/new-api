package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// A link in a message is not a publishing destination. The protected numeric
// channel ID must resolve to a channel on which this exact bot may post.
func validateAnnouncementChannel(ctx context.Context, cfg announcementBotConfig) (string, error) {
	meResult, ok := announcementAPI.call(ctx, cfg.Token, "getMe", map[string]any{})
	var me struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	}
	if !ok || !meResult.OK || common.Unmarshal(meResult.Result, &me) != nil || me.ID <= 0 || me.Username != cfg.Username {
		return "", ErrAnnouncementChannelUnavailable
	}
	chatResult, ok := announcementAPI.call(ctx, cfg.Token, "getChat", map[string]any{"chat_id": cfg.ChannelID})
	var chat struct {
		ID           int64  `json:"id"`
		Type         string `json:"type"`
		Title        string `json:"title"`
		LinkedChatID int64  `json:"linked_chat_id"`
	}
	if !ok || !chatResult.OK || common.Unmarshal(chatResult.Result, &chat) != nil || chat.ID != cfg.ChannelID || chat.Type != "channel" {
		return "", ErrAnnouncementChannelUnavailable
	}
	if chat.LinkedChatID != cfg.GroupID {
		return "", ErrAnnouncementDiscussionMismatch
	}
	memberResult, ok := announcementAPI.call(ctx, cfg.Token, "getChatMember", map[string]any{"chat_id": cfg.ChannelID, "user_id": me.ID})
	var member struct {
		Status          string `json:"status"`
		CanPostMessages bool   `json:"can_post_messages"`
	}
	if !ok || !memberResult.OK || common.Unmarshal(memberResult.Result, &member) != nil || (member.Status != "creator" && (member.Status != "administrator" || !member.CanPostMessages)) {
		return "", ErrAnnouncementChannelUnavailable
	}
	return chat.Title, nil
}

type announcementDelivery struct {
	status     string
	message    string
	messageID  int64
	messageURL string
}

func deliverAnnouncement(ctx context.Context, cfg announcementBotConfig, preview *AnnouncementPreview, chatID int64) announcementDelivery {
	payload := map[string]any{"chat_id": chatID, "text": preview.HTML, "parse_mode": "HTML", "link_preview_options": map[string]bool{"is_disabled": true}, "reply_markup": map[string]any{"inline_keyboard": [][]map[string]string{{{"text": preview.Template.ChannelLabel, "url": preview.Template.ChannelURL}}, {{"text": preview.Template.ContactLabel, "url": preview.Template.ContactURL}}}}}
	response, definitive := announcementAPI.call(ctx, cfg.Token, "sendMessage", payload)
	delivery := announcementDelivery{status: "unknown", message: "Delivery is unconfirmed. Check the Telegram group before publishing again."}
	if definitive && !response.OK {
		delivery.status, delivery.message = "failed", "Telegram rejected the announcement. Check bot permissions and message content."
	} else if response.OK && response.MessageID > 0 && response.ChatID == chatID {
		delivery.status, delivery.message = "sent", ""
		delivery.messageID = response.MessageID
		if chat := fmt.Sprint(chatID); strings.HasPrefix(chat, "-100") {
			delivery.messageURL = "https://t.me/c/" + strings.TrimPrefix(chat, "-100") + "/" + fmt.Sprint(delivery.messageID)
		}
	}
	return delivery
}
