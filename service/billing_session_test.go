package service

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// External DSNs must point to isolated test databases, never application data.
func TestSubscriptionBillingModelProviders(t *testing.T) {
	for _, dialect := range []struct {
		name common.DatabaseType
		env  string
	}{
		{common.DatabaseTypeSQLite, ""},
		{common.DatabaseTypeMySQL, "TEST_SUBSCRIPTION_MYSQL_DSN"},
		{common.DatabaseTypePostgreSQL, "TEST_SUBSCRIPTION_POSTGRES_DSN"},
	} {
		t.Run(string(dialect.name), func(t *testing.T) {
			var driver gorm.Dialector = sqlite.Open(":memory:")
			if dialect.env != "" {
				dsn := os.Getenv(dialect.env)
				if dsn == "" {
					t.Skip(dialect.env + " is not configured")
				}
				if dialect.name == common.DatabaseTypeMySQL {
					driver = mysql.Open(dsn)
				} else {
					driver = postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true})
				}
			}
			db, err := gorm.Open(driver, &gorm.Config{})
			require.NoError(t, err)
			sqlDB, err := db.DB()
			require.NoError(t, err)
			sqlDB.SetMaxOpenConns(1)
			t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
			oldDB := model.DB
			oldMainType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
			oldRedis, oldBatch := common.RedisEnabled, common.BatchUpdateEnabled
			model.DB = db
			common.SetDatabaseTypes(dialect.name, oldLogType)
			common.RedisEnabled, common.BatchUpdateEnabled = false, false
			t.Cleanup(func() {
				model.DB = oldDB
				common.SetDatabaseTypes(oldMainType, oldLogType)
				common.RedisEnabled, common.BatchUpdateEnabled = oldRedis, oldBatch
			})
			require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.SubscriptionPreConsumeRecord{}))
			versionQuery := "select version()"
			if dialect.name == common.DatabaseTypeSQLite {
				versionQuery = "select sqlite_version()"
			}
			var version string
			require.NoError(t, db.Raw(versionQuery).Scan(&version).Error)
			t.Logf("database: %s", version)

			for i, tc := range []struct {
				name, preference, allowed, source, model  string
				channel, metadataChannel                  int
				wallet                                    int
				priorPlans, exhausted, overflow, rejected bool
			}{
				{name: "GPT before metadata initialization", model: "gpt-4o", preference: "subscription_first", allowed: "1", channel: constant.ChannelTypeOpenAI, wallet: 1000, source: BillingSourceSubscription},
				{name: "Claude on OpenAI transport skips GPT plan", model: "claude-sonnet-4-5", preference: "subscription_only", allowed: "1", channel: constant.ChannelTypeOpenAI, wallet: 1000, source: BillingSourceWallet},
				{name: "GPT on different transport still uses GPT plan", model: "gpt-4o", preference: "wallet_only", allowed: "1", channel: constant.ChannelTypeAnthropic, wallet: 1000, source: BillingSourceSubscription},
				{name: "Claude matches Anthropic plan on compatible transport", model: "anthropic/claude-sonnet-4-5", preference: "wallet_first", allowed: "14", channel: constant.ChannelTypeOpenAI, wallet: 1000, source: BillingSourceSubscription},
				{name: "unrestricted plan accepts unknown model", model: "custom-model", preference: "subscription_only", channel: constant.ChannelTypeAnthropic, wallet: 1000, source: BillingSourceSubscription},
				{name: "stale metadata cannot change model ownership", model: "claude-sonnet-4-5", preference: "subscription_only", allowed: "1", channel: constant.ChannelTypeAnthropic, metadataChannel: constant.ChannelTypeOpenAI, wallet: 1000, source: BillingSourceWallet},
				{name: "unknown model never borrows transport ownership", model: "unknown-model", preference: "subscription_only", allowed: "1", metadataChannel: constant.ChannelTypeOpenAI, wallet: 1000, source: BillingSourceWallet},
				{name: "empty wallet still uses matching subscription", model: "gpt-4o", preference: "wallet_first", allowed: "1", channel: constant.ChannelTypeOpenAI, source: BillingSourceSubscription},
				{name: "legacy overflow restriction cannot block balance fallback", model: "claude-sonnet-4-5", preference: "subscription_first", allowed: "1", channel: constant.ChannelTypeAnthropic, wallet: 1000, rejected: false, source: BillingSourceWallet},
				{name: "mismatched subscription and insufficient wallet reject without charging", model: "claude-sonnet-4-5", preference: "subscription_only", allowed: "1", channel: constant.ChannelTypeAnthropic, wallet: 50, rejected: true},
				{name: "unknown model with empty wallet rejects", model: "unknown-model", preference: "wallet_only", allowed: "1", channel: constant.ChannelTypeOpenAI, rejected: true},
				{name: "skip mismatched and exhausted subscriptions before matching later plan", model: "claude-sonnet-4-5", preference: "subscription_only", allowed: "14", channel: constant.ChannelTypeOpenAI, wallet: 1000, priorPlans: true, source: BillingSourceSubscription},
				{name: "all matching subscriptions exhausted falls back to wallet", model: "claude-sonnet-4-5", preference: "subscription_only", allowed: "14", channel: constant.ChannelTypeOpenAI, wallet: 1000, priorPlans: true, exhausted: true, source: BillingSourceWallet},
				{name: "all subscriptions and wallet insufficient rejects without charging", model: "claude-sonnet-4-5", preference: "wallet_only", allowed: "14", channel: constant.ChannelTypeOpenAI, wallet: 50, priorPlans: true, exhausted: true, rejected: true},
			} {
				t.Run(tc.name, func(t *testing.T) {
					user := model.User{Username: fmt.Sprintf("billing_channel_%d", i), AffCode: fmt.Sprintf("bc%d", i), Quota: tc.wallet, Status: common.UserStatusEnabled}
					require.NoError(t, db.Create(&user).Error)
					t.Cleanup(func() { require.NoError(t, db.Unscoped().Delete(&user).Error) })
					token := model.Token{UserId: user.Id, Key: fmt.Sprintf("billing-channel-%d", i), RemainQuota: 1000, Status: common.TokenStatusEnabled}
					require.NoError(t, db.Create(&token).Error)
					t.Cleanup(func() { require.NoError(t, db.Unscoped().Delete(&token).Error) })
					plan := model.SubscriptionPlan{Title: tc.name, AllowedChannelTypes: tc.allowed, QuotaResetPeriod: model.SubscriptionResetNever}
					require.NoError(t, db.Create(&plan).Error)
					model.InvalidateSubscriptionPlanCache(plan.Id)
					t.Cleanup(func() {
						model.InvalidateSubscriptionPlanCache(plan.Id)
						require.NoError(t, db.Delete(&plan).Error)
					})
					now := model.GetDBTimestamp()
					sub := model.UserSubscription{UserId: user.Id, PlanId: plan.Id, AmountTotal: 1000, Status: "active", StartTime: now - 60, EndTime: now + 3600, AllowWalletOverflow: tc.overflow}
					if tc.exhausted {
						sub.AmountTotal = 50
					}
					require.NoError(t, db.Create(&sub).Error)
					var priorSubs []model.UserSubscription
					if tc.priorPlans {
						for j, allowed := range []string{"1", "14"} {
							priorPlan := model.SubscriptionPlan{Title: "prior plan", AllowedChannelTypes: allowed, QuotaResetPeriod: model.SubscriptionResetNever}
							require.NoError(t, db.Create(&priorPlan).Error)
							model.InvalidateSubscriptionPlanCache(priorPlan.Id)
							t.Cleanup(func() {
								model.InvalidateSubscriptionPlanCache(priorPlan.Id)
								require.NoError(t, db.Delete(&priorPlan).Error)
							})
							priorSub := model.UserSubscription{UserId: user.Id, PlanId: priorPlan.Id, AmountTotal: 1000, Status: "active", StartTime: now - 60, EndTime: now + 3600, UserPriority: 30 - j}
							if j == 1 {
								priorSub.AmountTotal = 50
							}
							require.NoError(t, db.Create(&priorSub).Error)
							priorSubs = append(priorSubs, priorSub)
							t.Cleanup(func() {
								require.NoError(t, db.Where("user_subscription_id = ?", priorSub.Id).Delete(&model.SubscriptionPreConsumeRecord{}).Error)
								require.NoError(t, db.Delete(&priorSub).Error)
							})
						}
					}

					t.Cleanup(func() {
						require.NoError(t, db.Where("user_subscription_id = ?", sub.Id).Delete(&model.SubscriptionPreConsumeRecord{}).Error)
						require.NoError(t, db.Delete(&sub).Error)
					})
					c, _ := gin.CreateTestContext(httptest.NewRecorder())
					c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
					if tc.channel != 0 {
						common.SetContextKey(c, constant.ContextKeyChannelType, tc.channel)
					}
					info := &relaycommon.RelayInfo{
						RequestId: fmt.Sprintf("billing-channel-%d", i), UserId: user.Id, TokenId: token.Id, TokenKey: token.Key,
						OriginModelName: tc.model, ForcePreConsume: true,
						UserSetting: dto.UserSetting{BillingPreference: tc.preference},
					}
					if tc.metadataChannel != 0 {
						info.ChannelMeta = &relaycommon.ChannelMeta{ChannelType: tc.metadataChannel}
					}
					var apiErr *types.NewAPIError
					require.NotPanics(t, func() { apiErr = PreConsumeBilling(c, 100, info) })
					if tc.rejected {
						require.NotNil(t, apiErr)
						assert.Equal(t, http.StatusForbidden, apiErr.StatusCode)
						assert.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
						assert.Nil(t, info.Billing)
					} else {
						require.Nil(t, apiErr)
						require.NotNil(t, info.Billing)
						assert.Equal(t, tc.source, info.BillingSource)
						assert.Equal(t, 100, info.Billing.GetPreConsumedQuota())
						require.NoError(t, info.Billing.Settle(80))
					}
					if tc.metadataChannel == 0 {
						assert.Nil(t, info.ChannelMeta, "billing must not initialize metadata used by channel retry selection")
					}
					require.NoError(t, db.First(&sub, sub.Id).Error)
					require.NoError(t, db.First(&token, token.Id).Error)
					require.NoError(t, db.First(&user, user.Id).Error)
					wantSub, wantToken, wantWallet := int64(0), 1000, tc.wallet
					if !tc.rejected {
						wantToken -= 80
						if tc.source == BillingSourceSubscription {
							wantSub = 80
						} else {
							wantWallet -= 80
						}
					}
					for _, prior := range priorSubs {
						require.NoError(t, db.First(&prior, prior.Id).Error)
						assert.Zero(t, prior.AmountUsed, "skipped subscriptions must not be charged")
					}
					assert.Equal(t, wantSub, sub.AmountUsed)
					assert.Equal(t, wantToken, token.RemainQuota)
					assert.Equal(t, wantWallet, user.Quota)
				})
			}
		})
	}
}
