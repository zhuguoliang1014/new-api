package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

const telegramAnnouncementTemplateKey = "TelegramAnnouncementTemplate"

var (
	ErrAnnouncementInvalid            = errors.New("Invalid announcement parameters")
	ErrAnnouncementChanged            = errors.New("The announcement template changed. Preview again before publishing.")
	ErrAnnouncementUnavailable        = errors.New("The announcement bot is not connected. Configure its protected server file first.")
	ErrAnnouncementChannelMissing     = errors.New("No announcement channel is configured.")
	ErrAnnouncementChannelUnavailable = errors.New("The bot cannot publish to the configured channel. Check the channel ID and administrator permissions.")
	ErrAnnouncementConflict           = errors.New("This publication ID belongs to a different announcement.")
)

type AnnouncementTemplate struct {
	ChannelLabel string `json:"channel_label"`
	ContactLabel string `json:"contact_label"`
	Footer       string `json:"footer"`
	ChannelURL   string `json:"channel_url"`
	ContactURL   string `json:"contact_url"`
}

type AnnouncementInput struct {
	Title            string `json:"title"`
	Body             string `json:"body"`
	Pin              bool   `json:"pin"`
	PublishToChannel bool   `json:"publish_to_channel"`
}

type AnnouncementPreview struct {
	AnnouncementInput
	Template      AnnouncementTemplate `json:"template"`
	Text          string               `json:"text"`
	Characters    int                  `json:"characters"`
	Hash          string               `json:"hash"`
	ChatID        int64                `json:"chat_id"`
	ChannelChatID int64                `json:"channel_chat_id"`
	ChannelTitle  string               `json:"channel_title"`
	BotUsername   string               `json:"bot_username"`
	HTML          string               `json:"-"`
}

type AnnouncementPublishRequest struct {
	AnnouncementInput
	ID          string `json:"id"`
	PreviewHash string `json:"preview_hash"`
}

type announcementBotConfig struct {
	Token     string `json:"token"`
	Username  string `json:"bot_username"`
	GroupID   int64  `json:"group_id"`
	ChannelID int64  `json:"channel_id"`
}

// Credentials stay in an operator-managed read-only mount. This deliberately
// does not reuse Telegram login credentials or touch the join bot's updates.
func loadAnnouncementBot() (announcementBotConfig, error) {
	var config announcementBotConfig
	path := os.Getenv("TELEGRAM_ANNOUNCEMENT_CONFIG")
	if path == "" {
		return config, ErrAnnouncementUnavailable
	}
	file, err := os.Open(path)
	if err != nil {
		return config, ErrAnnouncementUnavailable
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil || len(data) > 65536 || common.Unmarshal(data, &config) != nil || strings.TrimSpace(config.Token) == "" || config.GroupID >= 0 || config.Username == "" {
		return announcementBotConfig{}, ErrAnnouncementUnavailable
	}
	if config.ChannelID > 0 || (config.ChannelID != 0 && config.ChannelID == config.GroupID) {
		return announcementBotConfig{}, ErrAnnouncementUnavailable
	}
	return config, nil
}

func AnnouncementBotStatus() (bool, string, bool) {
	cfg, err := loadAnnouncementBot()
	return err == nil, cfg.Username, err == nil && cfg.ChannelID < 0
}

func GetAnnouncementTemplate() (AnnouncementTemplate, error) {
	defaults := AnnouncementTemplate{ChannelLabel: "频道地址", ContactLabel: "对接地址", Footer: "AiProxy · AI 模型 API 服务", ChannelURL: "https://t.me/+NrE5joFDk_MzZTRh", ContactURL: "https://92ai.asia/"}
	var option model.Option
	err := model.DB.Where(&model.Option{Key: telegramAnnouncementTemplateKey}).First(&option).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaults, nil
	}
	if err != nil {
		return defaults, err
	}
	if common.UnmarshalJsonStr(option.Value, &defaults) != nil {
		return defaults, ErrAnnouncementInvalid
	}
	return defaults, validateAnnouncementTemplate(defaults)
}

func validateAnnouncementTemplate(template AnnouncementTemplate) error {
	if strings.TrimSpace(template.ChannelLabel) == "" || strings.TrimSpace(template.ContactLabel) == "" || utf8.RuneCountInString(template.ChannelLabel) > 24 || utf8.RuneCountInString(template.ContactLabel) > 24 {
		return ErrAnnouncementInvalid
	}
	if !utf8.ValidString(template.Footer) || utf8.RuneCountInString(template.Footer) > 300 {
		return ErrAnnouncementInvalid
	}
	for _, raw := range []string{template.ChannelURL, template.ContactURL} {
		u, err := url.Parse(raw)
		if err != nil || len(raw) > 1000 || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || strings.ContainsAny(raw, "\r\n\t") {
			return ErrAnnouncementInvalid
		}
	}
	return nil
}

func SaveAnnouncementTemplate(template AnnouncementTemplate) error {
	template.Footer = strings.TrimSpace(template.Footer)
	template.ChannelURL = strings.TrimSpace(template.ChannelURL)
	template.ContactURL = strings.TrimSpace(template.ContactURL)
	if err := validateAnnouncementTemplate(template); err != nil {
		return err
	}
	data, err := common.Marshal(template)
	if err != nil {
		return err
	}
	return model.UpdateOption(telegramAnnouncementTemplateKey, string(data))
}

func announcementHash(value any) string {
	data, _ := common.Marshal(value)
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

func PreviewAnnouncement(input AnnouncementInput) (*AnnouncementPreview, error) {
	input.Title = strings.TrimSpace(input.Title)
	input.Body = strings.TrimSpace(input.Body)
	if input.Title == "" || input.Body == "" || !utf8.ValidString(input.Title+input.Body) || utf8.RuneCountInString(input.Title) > 120 {
		return nil, ErrAnnouncementInvalid
	}
	template, err := GetAnnouncementTemplate()
	if err != nil {
		return nil, err
	}
	text := input.Title + "\n\n" + input.Body
	rendered := "<b>" + html.EscapeString(input.Title) + "</b>\n\n" + html.EscapeString(input.Body)
	if template.Footer != "" {
		text += "\n\n" + template.Footer
		rendered += "\n\n" + html.EscapeString(template.Footer)
	}
	text += "\n" + template.ChannelLabel + "：" + template.ChannelURL + "\n" + template.ContactLabel + "：" + template.ContactURL
	rendered += "\n" + html.EscapeString(template.ChannelLabel) + "：<a href=\"" + html.EscapeString(template.ChannelURL) + "\">" + html.EscapeString(template.ChannelURL) + "</a>\n" + html.EscapeString(template.ContactLabel) + "：<a href=\"" + html.EscapeString(template.ContactURL) + "\">" + html.EscapeString(template.ContactURL) + "</a>"
	count := len(utf16.Encode([]rune(text)))
	if count > 4096 {
		return nil, ErrAnnouncementInvalid
	}
	preview := &AnnouncementPreview{AnnouncementInput: input, Template: template, Text: text, HTML: rendered, Characters: count}
	cfg, _ := loadAnnouncementBot()
	preview.ChatID, preview.BotUsername = cfg.GroupID, cfg.Username
	if input.PublishToChannel {
		if cfg.ChannelID == 0 {
			return nil, ErrAnnouncementChannelMissing
		}
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		title, err := validateAnnouncementChannel(ctx, cfg)
		if err != nil {
			return nil, err
		}
		preview.ChannelChatID, preview.ChannelTitle = cfg.ChannelID, title
	}
	preview.Hash = announcementHash(struct {
		Input     AnnouncementInput
		Template  AnnouncementTemplate
		ChatID    int64
		Username  string
		ChannelID int64
	}{input, template, cfg.GroupID, cfg.Username, preview.ChannelChatID})
	return preview, nil
}

// Telegram returns no delivery idempotency key. Any transport or ambiguous
// protocol failure is recorded as unknown and is never replayed automatically.
type announcementTelegram struct {
	client  *http.Client
	baseURL string
}

var announcementAPI = announcementTelegram{client: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, baseURL: "https://api.telegram.org"}

type announcementAPIResult struct {
	OK        bool            `json:"ok"`
	ErrorCode int             `json:"error_code"`
	Result    json.RawMessage `json:"result"`
	MessageID int64           `json:"-"`
	ChatID    int64           `json:"-"`
}

func (api announcementTelegram) call(ctx context.Context, token, method string, payload any) (announcementAPIResult, bool) {
	var result announcementAPIResult
	data, err := common.Marshal(payload)
	if err != nil {
		return result, false
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, api.baseURL+"/bot"+token+"/"+method, strings.NewReader(string(data)))
	if err != nil {
		return result, false
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := api.client.Do(request)
	if err != nil {
		return result, false
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || common.Unmarshal(body, &result) != nil {
		return result, false
	}
	// Do not surface Telegram's raw error body or URL, which can include secrets.
	if result.OK && method == "sendMessage" {
		var message struct {
			MessageID int64 `json:"message_id"`
			Chat      struct {
				ID int64 `json:"id"`
			} `json:"chat"`
		}
		if common.Unmarshal(result.Result, &message) != nil {
			return announcementAPIResult{}, false
		}
		result.MessageID, result.ChatID = message.MessageID, message.Chat.ID
	}
	if !result.OK {
		return result, response.StatusCode >= 400 && response.StatusCode < 500 && result.ErrorCode == response.StatusCode
	}
	return result, true
}

func PublishAnnouncement(ctx context.Context, operatorID int, request AnnouncementPublishRequest) (*model.TelegramAnnouncement, error) {
	if id, err := uuid.Parse(request.ID); err != nil || id.String() != request.ID || len(request.PreviewHash) != 64 {
		return nil, ErrAnnouncementInvalid
	}
	requestHash := announcementHash(request)
	existing, err := model.GetTelegramAnnouncement(request.ID)
	if err == nil {
		if existing.RequestHash != requestHash {
			return nil, ErrAnnouncementConflict
		}
		return existing, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	preview, err := PreviewAnnouncement(request.AnnouncementInput)
	if err != nil {
		return nil, err
	}
	if preview.Hash != request.PreviewHash {
		return nil, ErrAnnouncementChanged
	}
	cfg, err := loadAnnouncementBot()
	if err != nil {
		return nil, err
	}
	if cfg.GroupID != preview.ChatID || cfg.Username != preview.BotUsername || (request.PublishToChannel && cfg.ChannelID != preview.ChannelChatID) {
		return nil, ErrAnnouncementChanged
	}
	record := &model.TelegramAnnouncement{ID: request.ID, RequestHash: requestHash, OperatorID: operatorID, Title: preview.Title, Body: preview.Body, Footer: preview.Template.Footer, ChannelLabel: preview.Template.ChannelLabel, ContactLabel: preview.Template.ContactLabel, ChannelURL: preview.Template.ChannelURL, ContactURL: preview.Template.ContactURL, ChatID: cfg.GroupID, Status: "prepared", PinRequested: request.Pin, PinStatus: "not_requested", CreatedAt: time.Now().Unix()}
	record.ChannelRequested = request.PublishToChannel
	record.ChannelStatus = "not_requested"
	if request.PublishToChannel {
		record.ChannelChatID = preview.ChannelChatID
		record.ChannelTitle = preview.ChannelTitle
		record.ChannelStatus = "queued"
	}
	if request.Pin {
		record.PinStatus = "pending"
	}
	reserved, err := model.ReserveTelegramAnnouncement(record)
	if err != nil {
		return nil, err
	}
	if !reserved {
		existing, err = model.GetTelegramAnnouncement(request.ID)
		if err == nil && existing.RequestHash != requestHash {
			return nil, ErrAnnouncementConflict
		}
		return existing, err
	}
	// Finish and persist the receipt even if the browser disconnects mid-send.
	sendCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 70*time.Second)
	defer cancel()
	group := deliverAnnouncement(sendCtx, cfg, preview, cfg.GroupID)
	record.Status, record.Error = group.status, group.message
	record.MessageID, record.MessageURL = group.messageID, group.messageURL
	if err := model.UpdateTelegramAnnouncement(record.ID, map[string]any{"status": record.Status, "message_id": record.MessageID, "message_url": record.MessageURL, "error": record.Error}); err != nil {
		return nil, err
	}
	if record.Status == "sent" && request.Pin {
		record.PinStatus = "failed"
		if result, ok := announcementAPI.call(sendCtx, cfg.Token, "pinChatMessage", map[string]any{"chat_id": cfg.GroupID, "message_id": record.MessageID, "disable_notification": true}); ok && result.OK && string(result.Result) == "true" {
			record.PinStatus = "pinned"
		}
		if err := model.UpdateTelegramAnnouncement(record.ID, map[string]any{"pin_status": record.PinStatus}); err != nil {
			return nil, err
		}
	}
	if request.PublishToChannel {
		// Persist an independent state before sending to the second destination.
		// A retry of the publication ID only returns this receipt, never resumes it.
		if err := model.UpdateTelegramAnnouncement(record.ID, map[string]any{"channel_status": "sending"}); err != nil {
			return nil, err
		}
		channel := deliverAnnouncement(sendCtx, cfg, preview, record.ChannelChatID)
		record.ChannelStatus, record.ChannelError = channel.status, channel.message
		record.ChannelMessageID, record.ChannelMessageURL = channel.messageID, channel.messageURL
		if record.ChannelStatus == "unknown" {
			record.ChannelError = "Channel delivery is unconfirmed. Check the channel before publishing again."
		}
		if record.ChannelStatus == "failed" {
			record.ChannelError = "Telegram rejected the channel announcement. Check bot permissions and message content."
		}
		if err := model.UpdateTelegramAnnouncement(record.ID, map[string]any{"channel_status": record.ChannelStatus, "channel_error": record.ChannelError, "channel_message_id": record.ChannelMessageID, "channel_message_url": record.ChannelMessageURL}); err != nil {
			return nil, err
		}
	}
	return record, nil
}
