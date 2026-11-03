package service

import (
	"context"
	"maps"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"gorm.io/gorm/schema"
)

func TestTelegramAnnouncementDatabaseMatrix(t *testing.T) {
	for _, dialect := range []string{"sqlite", "mysql", "postgres"} {
		t.Run(dialect, func(t *testing.T) {
			var driver gorm.Dialector
			switch dialect {
			case "sqlite":
				driver = sqlite.Open(filepath.Join(t.TempDir(), "announcements.db"))
			case "mysql":
				if os.Getenv("TEST_MYSQL_DSN") == "" {
					t.Skip("TEST_MYSQL_DSN not configured")
				}
				driver = mysql.Open(os.Getenv("TEST_MYSQL_DSN"))
			case "postgres":
				if os.Getenv("TEST_POSTGRES_DSN") == "" {
					t.Skip("TEST_POSTGRES_DSN not configured")
				}
				driver = postgres.Open(os.Getenv("TEST_POSTGRES_DSN"))
			}
			db, err := gorm.Open(driver, &gorm.Config{NamingStrategy: schema.NamingStrategy{TablePrefix: "announcement_test_"}, Logger: logger.Default.LogMode(logger.Silent)})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			oldDB, oldAPI := model.DB, announcementAPI
			common.OptionMapRWMutex.Lock()
			oldOptions := maps.Clone(common.OptionMap)
			common.OptionMap = make(map[string]string)
			common.OptionMapRWMutex.Unlock()
			model.DB = db
			t.Cleanup(func() {
				assert.NoError(t, db.Migrator().DropTable(&model.TelegramAnnouncement{}, &model.Option{}))
				assert.NoError(t, sqlDB.Close())
				model.DB, announcementAPI = oldDB, oldAPI
				common.OptionMapRWMutex.Lock()
				common.OptionMap = oldOptions
				common.OptionMapRWMutex.Unlock()
			})
			// Fresh schema creation and a simulated upgrade from the previous tables.
			require.NoError(t, db.AutoMigrate(&model.Option{}, &model.TelegramAnnouncement{}))
			assert.True(t, db.Migrator().HasIndex(&model.TelegramAnnouncement{}, "Status"))
			assert.True(t, db.Migrator().HasIndex(&model.TelegramAnnouncement{}, "CreatedAt"))
			require.NoError(t, db.Migrator().DropTable(&model.TelegramAnnouncement{}))
			// Upgrade the previously implemented receipt schema with a retained
			// group-only publication, then run migration twice.
			require.NoError(t, db.AutoMigrate(&model.TelegramAnnouncement{}))
			for _, field := range []string{"ChannelRequested", "ChannelChatID", "ChannelTitle", "ChannelStatus", "ChannelMessageID", "ChannelMessageURL", "ChannelError"} {
				require.NoError(t, db.Migrator().DropColumn(&model.TelegramAnnouncement{}, field))
			}
			legacyID := uuid.NewString()
			tableName := db.NamingStrategy.TableName("TelegramAnnouncement")
			require.NoError(t, db.Table(tableName).Create(map[string]any{"id": legacyID, "request_hash": strings.Repeat("a", 64), "status": "sent", "title": "Previous group publication", "message_id": 9, "created_at": 1}).Error)
			// Latest-release options table plus an existing row represents an upgrade.
			require.NoError(t, db.AutoMigrate(&model.Option{}))
			require.NoError(t, db.Create(&model.Option{Key: "existing_setting", Value: "preserved"}).Error)
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.TelegramAnnouncement{}))
			}
			legacy, err := model.GetTelegramAnnouncement(legacyID)
			require.NoError(t, err)
			assert.Equal(t, "Previous group publication", legacy.Title)
			assert.Equal(t, "sent", legacy.Status)
			assert.False(t, legacy.ChannelRequested)
			var original model.Option
			require.NoError(t, db.Where(&model.Option{Key: "existing_setting"}).First(&original).Error)
			assert.Equal(t, "preserved", original.Value)
			var version string
			versionQuery := "SELECT version()"
			if dialect == "sqlite" {
				versionQuery = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database version: %s", version)

			configPath := filepath.Join(t.TempDir(), "bot.json")
			require.NoError(t, os.WriteFile(configPath, []byte(`{"token":"test-secret","bot_username":"announcement_test_bot","group_id":-100123}`), 0600))
			t.Setenv("TELEGRAM_ANNOUNCEMENT_CONFIG", configPath)
			var sends, pins, channelSends atomic.Int64
			var mode atomic.Value
			mode.Store("success")
			entered, release := make(chan struct{}, 1), make(chan struct{})
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var payload map[string]any
				assert.NoError(t, common.DecodeJson(r.Body, &payload))
				switch {
				case strings.HasSuffix(r.URL.Path, "/getMe"):
					_, _ = w.Write([]byte(`{"ok":true,"result":{"id":1234,"username":"announcement_test_bot"}}`))
					return
				case strings.HasSuffix(r.URL.Path, "/getChat"):
					chatType := "channel"
					if mode.Load().(string) == "wrong_type" {
						chatType = "supergroup"
					}
					_, _ = w.Write([]byte(`{"ok":true,"result":{"id":-100456,"type":"` + chatType + `","title":"AiProxy announcements"}}`))
					return
				case strings.HasSuffix(r.URL.Path, "/getChatMember"):
					permission := "true"
					if mode.Load().(string) == "no_permission" {
						permission = "false"
					}
					_, _ = w.Write([]byte(`{"ok":true,"result":{"status":"administrator","can_post_messages":` + permission + `}}`))
					return
				}
				if strings.HasSuffix(r.URL.Path, "/pinChatMessage") {
					pins.Add(1)
					if mode.Load().(string) == "pin_failed" {
						w.WriteHeader(403)
						_, _ = w.Write([]byte(`{"ok":false,"error_code":403}`))
						return
					}
					_, _ = w.Write([]byte(`{"ok":true,"result":true}`))
					return
				}
				sends.Add(1)
				isChannel := payload["chat_id"] == float64(-100456)
				if isChannel {
					channelSends.Add(1)
				} else {
					assert.Equal(t, float64(-100123), payload["chat_id"])
				}
				assert.Contains(t, payload["text"], "&lt;script&gt;")
				assert.NotContains(t, payload["text"], "<script>")
				assert.Equal(t, "HTML", payload["parse_mode"])
				keyboard := payload["reply_markup"].(map[string]any)["inline_keyboard"].([]any)
				assert.Len(t, keyboard, 2)
				assert.Equal(t, "https://t.me/+NrE5joFDk_MzZTRh", keyboard[0].([]any)[0].(map[string]any)["url"])
				assert.Equal(t, "https://92ai.asia/", keyboard[1].([]any)[0].(map[string]any)["url"])
				if isChannel {
					switch mode.Load().(string) {
					case "channel_rejected":
						w.WriteHeader(403)
						_, _ = w.Write([]byte(`{"ok":false,"error_code":403}`))
						return
					case "channel_ambiguous":
						w.WriteHeader(502)
						_, _ = w.Write([]byte(`{"ok":false,"error_code":502}`))
						return
					}
					_, _ = w.Write([]byte(`{"ok":true,"result":{"message_id":84,"chat":{"id":-100456}}}`))
					return
				}
				if mode.Load().(string) == "group_rejected" {
					w.WriteHeader(403)
					_, _ = w.Write([]byte(`{"ok":false,"error_code":403}`))
					return
				}
				switch mode.Load().(string) {
				case "blocked":
					entered <- struct{}{}
					<-release
				case "rejected":
					w.WriteHeader(400)
					_, _ = w.Write([]byte(`{"ok":false,"error_code":400,"description":"do not expose test-secret"}`))
					return
				case "ambiguous":
					w.WriteHeader(502)
					_, _ = w.Write([]byte(`{"ok":false,"error_code":502}`))
					return
				case "malformed":
					_, _ = w.Write([]byte(`unparseable response`))
					return
				}
				_, _ = w.Write([]byte(`{"ok":true,"result":{"message_id":42,"chat":{"id":-100123}}}`))
			}))
			defer server.Close()
			announcementAPI = announcementTelegram{client: server.Client(), baseURL: server.URL}
			input := AnnouncementInput{Title: "WSS 上线", Body: "已支持 <script> & HTTPS", Pin: true}
			preview, err := PreviewAnnouncement(input)
			require.NoError(t, err)
			assert.Contains(t, preview.Text, "频道地址：https://t.me/+NrE5joFDk_MzZTRh")
			request := AnnouncementPublishRequest{AnnouncementInput: input, ID: uuid.NewString(), PreviewHash: preview.Hash}
			t.Run("concurrent retry sends once and pins the returned message", func(t *testing.T) {
				mode.Store("blocked")
				done := make(chan error, 1)
				go func() { _, err := PublishAnnouncement(context.Background(), 1, request); done <- err }()
				<-entered
				duplicate, err := PublishAnnouncement(context.Background(), 1, request)
				require.NoError(t, err)
				assert.Equal(t, "sending", duplicate.Status)
				close(release)
				require.NoError(t, <-done)
				record, err := PublishAnnouncement(context.Background(), 1, request)
				require.NoError(t, err)
				assert.Equal(t, "sent", record.Status)
				assert.Equal(t, "pinned", record.PinStatus)
				assert.Equal(t, "https://t.me/c/123/42", record.MessageURL)
				assert.EqualValues(t, 1, sends.Load())
				assert.EqualValues(t, 1, pins.Load())
				request.Body = "changed content"
				_, err = PublishAnnouncement(context.Background(), 1, request)
				assert.ErrorIs(t, err, ErrAnnouncementConflict)
				request.Body = input.Body
			})
			for _, tc := range []struct{ mode, status, pin string }{{"rejected", "failed", "pending"}, {"ambiguous", "unknown", "pending"}, {"malformed", "unknown", "pending"}, {"pin_failed", "sent", "failed"}} {
				t.Run(tc.mode+" is recorded without replay", func(t *testing.T) {
					mode.Store(tc.mode)
					request.ID = uuid.NewString()
					before := sends.Load()
					record, err := PublishAnnouncement(context.Background(), 1, request)
					require.NoError(t, err)
					assert.Equal(t, tc.status, record.Status)
					assert.Equal(t, tc.pin, record.PinStatus)
					_, err = PublishAnnouncement(context.Background(), 1, request)
					require.NoError(t, err)
					assert.Equal(t, before+1, sends.Load())
					assert.NotContains(t, record.Error, "test-secret")
				})
			}
			t.Run("stale previews and unsafe templates cannot send", func(t *testing.T) {
				template, err := GetAnnouncementTemplate()
				require.NoError(t, err)
				template.ContactURL = "javascript:alert(1)"
				assert.ErrorIs(t, SaveAnnouncementTemplate(template), ErrAnnouncementInvalid)
				template.ContactURL = "https://92ai.asia/"
				template.Footer = "Updated footer"
				require.NoError(t, SaveAnnouncementTemplate(template))
				before := sends.Load()
				request.ID = uuid.NewString()
				_, err = PublishAnnouncement(context.Background(), 1, request)
				assert.ErrorIs(t, err, ErrAnnouncementChanged)
				assert.Equal(t, before, sends.Load())
				updated, err := GetAnnouncementTemplate()
				require.NoError(t, err)
				assert.Equal(t, "Updated footer", updated.Footer)
			})
			t.Run("text length counts UTF16 and includes the footer", func(t *testing.T) {
				_, err := PreviewAnnouncement(AnnouncementInput{Title: "", Body: "body"})
				assert.ErrorIs(t, err, ErrAnnouncementInvalid)
				_, err = PreviewAnnouncement(AnnouncementInput{Title: "title", Body: strings.Repeat("😀", 2100)})
				assert.ErrorIs(t, err, ErrAnnouncementInvalid)
				short, err := PreviewAnnouncement(AnnouncementInput{Title: "title", Body: "body"})
				require.NoError(t, err)
				padding := 4096 - short.Characters
				_, err = PreviewAnnouncement(AnnouncementInput{Title: "title", Body: "body" + strings.Repeat("x", padding)})
				require.NoError(t, err)
				_, err = PreviewAnnouncement(AnnouncementInput{Title: "title", Body: "body" + strings.Repeat("x", padding+1)})
				assert.ErrorIs(t, err, ErrAnnouncementInvalid)
			})
			t.Run("migration and restart preserve receipts and uniqueness", func(t *testing.T) {
				require.NoError(t, db.AutoMigrate(&model.TelegramAnnouncement{}))
				records, total, err := model.ListTelegramAnnouncements(1, 20)
				require.NoError(t, err)
				assert.EqualValues(t, 6, total)
				require.Len(t, records, 6)
				before := sends.Load()
				_, err = PublishAnnouncement(context.Background(), 1, request)
				assert.ErrorIs(t, err, ErrAnnouncementChanged)
				assert.Equal(t, before, sends.Load())
				var persisted model.TelegramAnnouncement
				require.NoError(t, db.Where("id = ?", records[0].ID).First(&persisted).Error)
				assert.NotEmpty(t, persisted.RequestHash)
				assert.Error(t, db.Create(&persisted).Error)
			})
			t.Run("channel selection is explicit and missing configuration cannot send", func(t *testing.T) {
				before := sends.Load()
				channelInput := input
				channelInput.PublishToChannel = true
				_, err := PreviewAnnouncement(channelInput)
				assert.ErrorIs(t, err, ErrAnnouncementChannelMissing)
				assert.Equal(t, before, sends.Load())
				assert.EqualValues(t, 0, channelSends.Load(), "group-only requests must not post to a channel")
			})
			require.NoError(t, os.WriteFile(configPath, []byte(`{"token":"test-secret","bot_username":"announcement_test_bot","group_id":-100123,"channel_id":-100456}`), 0600))
			for _, failure := range []string{"no_permission", "wrong_type"} {
				t.Run(failure+" rejects before either destination is sent", func(t *testing.T) {
					mode.Store(failure)
					before := sends.Load()
					channelInput := input
					channelInput.PublishToChannel = true
					_, err := PreviewAnnouncement(channelInput)
					assert.ErrorIs(t, err, ErrAnnouncementChannelUnavailable)
					assert.Equal(t, before, sends.Load())
				})
			}
			for _, tc := range []struct{ mode, groupStatus, channelStatus string }{
				{"success", "sent", "sent"},
				{"channel_rejected", "sent", "failed"},
				{"channel_ambiguous", "sent", "unknown"},
				{"group_rejected", "failed", "sent"},
			} {
				t.Run(tc.mode+" records group and channel independently without duplicate delivery", func(t *testing.T) {
					mode.Store(tc.mode)
					channelInput := input
					channelInput.PublishToChannel = true
					preview, err := PreviewAnnouncement(channelInput)
					require.NoError(t, err)
					assert.Equal(t, "AiProxy announcements", preview.ChannelTitle)
					request := AnnouncementPublishRequest{AnnouncementInput: channelInput, ID: uuid.NewString(), PreviewHash: preview.Hash}
					before, beforeChannel := sends.Load(), channelSends.Load()
					record, err := PublishAnnouncement(context.Background(), 1, request)
					require.NoError(t, err)
					assert.Equal(t, tc.groupStatus, record.Status)
					assert.Equal(t, tc.channelStatus, record.ChannelStatus)
					assert.True(t, record.ChannelRequested)
					assert.EqualValues(t, -100456, record.ChannelChatID)
					if tc.channelStatus == "sent" {
						assert.Equal(t, "https://t.me/c/456/84", record.ChannelMessageURL)
					}
					if tc.groupStatus == "sent" {
						assert.Equal(t, "pinned", record.PinStatus)
					}
					_, err = PublishAnnouncement(context.Background(), 1, request)
					require.NoError(t, err)
					assert.Equal(t, before+2, sends.Load())
					assert.Equal(t, beforeChannel+1, channelSends.Load())
					request.PublishToChannel = false
					_, err = PublishAnnouncement(context.Background(), 1, request)
					assert.ErrorIs(t, err, ErrAnnouncementConflict)
				})
			}
			t.Run("changing the channel after preview requires confirmation again", func(t *testing.T) {
				mode.Store("success")
				channelInput := input
				channelInput.PublishToChannel = true
				preview, err := PreviewAnnouncement(channelInput)
				require.NoError(t, err)
				require.NoError(t, os.WriteFile(configPath, []byte(`{"token":"test-secret","bot_username":"announcement_test_bot","group_id":-100123,"channel_id":-100789}`), 0600))
				// The fake server still identifies the old destination, so validation rejects.
				before := sends.Load()
				_, err = PublishAnnouncement(context.Background(), 1, AnnouncementPublishRequest{AnnouncementInput: channelInput, ID: uuid.NewString(), PreviewHash: preview.Hash})
				assert.ErrorIs(t, err, ErrAnnouncementChannelUnavailable)
				assert.Equal(t, before, sends.Load())
			})

		})
	}
}
