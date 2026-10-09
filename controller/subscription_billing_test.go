package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	kittypes "github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func subscriptionBillingDB(t *testing.T, committed ...bool) *gorm.DB {
	useTransaction := len(committed) == 0 || !committed[0]
	t.Helper()
	dialect := common.DatabaseTypeSQLite
	var driver gorm.Dialector = sqlite.Open(":memory:")
	switch os.Getenv("TEST_SUBSCRIPTION_CONTROLLER_DIALECT") {
	case "mysql":
		dialect = common.DatabaseTypeMySQL
		driver = mysql.Open(os.Getenv("TEST_SUBSCRIPTION_MYSQL_DSN"))
	case "postgres":
		dialect = common.DatabaseTypePostgreSQL
		driver = postgres.New(postgres.Config{DSN: os.Getenv("TEST_SUBSCRIPTION_POSTGRES_DSN"), PreferSimpleProtocol: true})
	}
	db, err := gorm.Open(driver, &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldConsume, oldExport := common.LogConsumeEnabled, common.DataExportEnabled
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis, oldBatch, oldMemory := common.RedisEnabled, common.BatchUpdateEnabled, common.MemoryCacheEnabled
	common.SetDatabaseTypes(dialect, dialect)
	common.RedisEnabled, common.BatchUpdateEnabled, common.MemoryCacheEnabled = false, false, false
	t.Cleanup(func() {
		if useTransaction {
			require.NoError(t, db.Rollback().Error)
		}
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.LogConsumeEnabled, common.DataExportEnabled = oldConsume, oldExport
		common.SetDatabaseTypes(oldMain, oldLog)
		common.RedisEnabled, common.BatchUpdateEnabled, common.MemoryCacheEnabled = oldRedis, oldBatch, oldMemory
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.SubscriptionPreConsumeRecord{}, &model.Channel{}, &model.Log{}))
	if useTransaction {
		db = db.Begin()
		require.NoError(t, db.Error)
	}
	model.DB, model.LOG_DB = db, db
	common.LogConsumeEnabled, common.DataExportEnabled = true, false
	return db
}

func TestSubscriptionModelRestrictionUpdatePersists(t *testing.T) {
	for _, tc := range []struct{ name, before, after string }{
		{"add restriction", "", "1"},
		{"change restriction", "1", "14"},
		{"remove restriction", "1", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := subscriptionBillingDB(t)
			confirmPaymentComplianceForTest(t)
			plan := model.SubscriptionPlan{Title: "review plan", PriceAmount: 10, PriceCNY: 70, AllowedChannelTypes: tc.before}
			body, err := common.Marshal(AdminUpsertSubscriptionPlanRequest{Plan: plan})
			require.NoError(t, err)
			createRecorder := httptest.NewRecorder()
			createContext, _ := gin.CreateTestContext(createRecorder)
			createContext.Request = httptest.NewRequest(http.MethodPost, "/api/subscription/admin/plans", bytes.NewReader(body))
			createContext.Request.Header.Set("Content-Type", "application/json")
			AdminCreateSubscriptionPlan(createContext)
			require.Contains(t, createRecorder.Body.String(), `"success":true`)
			require.NoError(t, db.First(&plan).Error)
			require.Equal(t, tc.before, plan.AllowedChannelTypes)
			t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
			plan.AllowedChannelTypes = tc.after
			body, err = common.Marshal(AdminUpsertSubscriptionPlanRequest{Plan: plan})
			require.NoError(t, err)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(plan.Id)}}
			c.Request = httptest.NewRequest(http.MethodPut, "/api/subscription/admin/plans/1", bytes.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			AdminUpdateSubscriptionPlan(c)
			require.Contains(t, recorder.Body.String(), `"success":true`)
			var saved model.SubscriptionPlan
			require.NoError(t, db.First(&saved, plan.Id).Error)
			assert.Equal(t, tc.after, saved.AllowedChannelTypes, "successful update must persist requested model restriction")
		})
	}
}

func TestSubscriptionModelOwnershipSurvivesTransportRetry(t *testing.T) {
	for _, tc := range []struct {
		name, model, source string
		used                int64
	}{
		{"Claude never charges GPT plan", "claude-sonnet-4-5", service.BillingSourceWallet, 0},
		{"GPT retains GPT plan across transport switch", "gpt-4o", service.BillingSourceSubscription, 80},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := subscriptionBillingDB(t)
			user := model.User{Username: "review", Quota: 1000, Status: common.UserStatusEnabled}
			require.NoError(t, db.Create(&user).Error)
			token := model.Token{UserId: user.Id, Key: "review-token", RemainQuota: 1000, Status: common.TokenStatusEnabled}
			require.NoError(t, db.Create(&token).Error)
			plan := model.SubscriptionPlan{Title: "OpenAI only", AllowedChannelTypes: "1", QuotaResetPeriod: model.SubscriptionResetNever}
			require.NoError(t, db.Create(&plan).Error)
			model.InvalidateSubscriptionPlanCache(plan.Id)
			t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
			now := model.GetDBTimestamp()
			sub := model.UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "active", AmountTotal: 1000, StartTime: now - 60, EndTime: now + 3600}
			require.NoError(t, db.Create(&sub).Error)
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
			baseURL := "http://127.0.0.1:1"
			first := model.Channel{Id: 1, Type: constant.ChannelTypeOpenAI, Name: "first", Key: "test-key", BaseURL: &baseURL}
			require.Nil(t, middleware.SetupContextForSelectedChannel(c, &first, "review-model"))
			info := &relaycommon.RelayInfo{RequestId: "review-retry", UserId: user.Id, TokenId: token.Id, TokenKey: token.Key, OriginModelName: tc.model, UsingGroup: "default", ForcePreConsume: true, UserSetting: dto.UserSetting{BillingPreference: "subscription_only"}}
			require.Nil(t, service.PreConsumeBilling(c, 100, info))
			require.Equal(t, tc.source, info.BillingSource)
			info.InitChannelMeta(c)
			// Reproduce Relay's retry lifecycle: replace the selected context, run
			// its before-attempt billing hook, initialize adaptor metadata, settle.
			second := model.Channel{Id: 2, Type: constant.ChannelTypeAnthropic, Name: "retry", Key: "test-key", BaseURL: &baseURL}
			require.False(t, plan.AllowsChannelType(second.Type))
			require.Nil(t, middleware.SetupContextForSelectedChannel(c, &second, "review-model"))
			info.RetryIndex = 1
			require.Nil(t, service.PrepareTieredBillingForSelectedGroup(c, info))
			info.InitChannelMeta(c)
			require.Equal(t, constant.ChannelTypeAnthropic, info.GetChannelType())
			require.NoError(t, info.Billing.Settle(80))
			var persisted model.UserSubscription
			require.NoError(t, db.First(&persisted, sub.Id).Error)
			t.Logf("actual channel type=%d, allowed=%s, billed subscription quota=%d", info.GetChannelType(), plan.AllowedChannelTypes, persisted.AmountUsed)
			assert.Equal(t, tc.used, persisted.AmountUsed, "model ownership must not change when the transport changes")
		})
	}
}

func TestSubscriptionModelProviderValidation(t *testing.T) {
	for _, tc := range []struct {
		raw, normalized string
		invalid         bool
	}{
		{raw: "", normalized: ""},
		{raw: " 1,14,1 ", normalized: "1,14"},
		{raw: "3", invalid: true}, // Azure is a transport, not a model family.
		{raw: "0", invalid: true},
		{raw: "1,garbage", invalid: true},
		{raw: "1,", invalid: true},
		{raw: strings.Repeat("1,", 257), invalid: true},
	} {
		t.Run(tc.raw[:min(len(tc.raw), 30)], func(t *testing.T) {
			actual, err := model.NormalizeSubscriptionModelProviders(tc.raw)
			if tc.invalid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.normalized, actual)
		})
	}
	for _, tc := range []struct {
		model, allowed string
		matches        bool
	}{
		{" OpenAI/GPT-4o ", "1", true},
		{"us.anthropic.claude-sonnet-4-5-v1:0", "14", true},
		{"openai/claude-sonnet-4-5", "1", false},
		{"o3", "1", true},
		{"gemini-2.5-pro", "24", true},
		{"deepseek-chat", "43", true},
		{"kimi-k2", "25", true},
		{"grok-4", "48", true},
		{"qwen3-32b", "17", true},
		{"glm-4.5", "26", true},
		{"MiniMax-M2", "35", true},
		{"mistral-large-latest", "42", true},
		{"my-gpt-alias", "1", false},
		{"claudeish", "14", false},
		{"custom", "", true},
	} {
		t.Run(tc.model, func(t *testing.T) {
			plan := model.SubscriptionPlan{AllowedChannelTypes: tc.allowed}
			assert.Equal(t, tc.matches, plan.AllowsModel(tc.model))
		})
	}
}

func TestSubscriptionModelRestrictionRejectsInvalidSave(t *testing.T) {
	db := subscriptionBillingDB(t)
	confirmPaymentComplianceForTest(t)
	plan := model.SubscriptionPlan{Title: "validated plan", PriceAmount: 10, PriceCNY: 70, AllowedChannelTypes: "1"}
	require.NoError(t, db.Create(&plan).Error)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	for _, update := range []bool{false, true} {
		for _, raw := range []string{"3", "0", "1,garbage", "1,", strings.Repeat("1,", 257)} {
			plan.AllowedChannelTypes = raw
			body, err := common.Marshal(AdminUpsertSubscriptionPlanRequest{Plan: plan})
			require.NoError(t, err)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/api/subscription/admin/plans", bytes.NewReader(body))
			c.Request.Header.Set("Content-Type", "application/json")
			if update {
				c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(plan.Id)}}
				AdminUpdateSubscriptionPlan(c)
			} else {
				AdminCreateSubscriptionPlan(c)
			}
			require.Contains(t, recorder.Body.String(), `"success":false`)
			var saved model.SubscriptionPlan
			require.NoError(t, db.First(&saved, plan.Id).Error)
			assert.Equal(t, "1", saved.AllowedChannelTypes)
			var count int64
			require.NoError(t, db.Model(&model.SubscriptionPlan{}).Count(&count).Error)
			assert.EqualValues(t, 1, count)
		}
	}
}

// Runs pricing -> subscription selection -> reservation -> retry pricing ->
// actual usage settlement -> log, against each externally selected dialect.
func TestSubscriptionFundingPriorityAndGroupRate(t *testing.T) {
	oldQuota := common.QuotaPerUnit
	common.QuotaPerUnit = 500000
	t.Cleanup(func() { common.QuotaPerUnit = oldQuota })
	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error { saved[key] = value; return nil }))
	t.Cleanup(func() { require.NoError(t, config.GlobalConfig.LoadFromDB(saved)) })
	type planSpec struct {
		allowed  string
		quota    int64
		priority int
	}
	special := planSpec{"1", 1000, 20}
	general := planSpec{"", 1000, 10}
	for _, mode := range []string{"ratio", "per_call", "tiered_token", "tiered_fixed"} {
		t.Run(mode, func(t *testing.T) {
			for _, tc := range []struct {
				name, model                                                                     string
				plans                                                                           []planSpec
				wallet                                                                          int
				selected                                                                        int // -1 = wallet; rejected cases must leave all accounts unchanged.
				rejected, tokenInsufficient, refund, retry, specialGroup, freeGroup, emptyToken bool
				realtime, task                                                                  bool
			}{
				{name: "GPT-only plan uses rate one", model: "gpt-4o", plans: []planSpec{special}, wallet: 1000, selected: 0},
				{name: "GPT prefix without dash", model: "gpt5-custom", plans: []planSpec{special}, wallet: 1000, selected: 0},
				{name: "Claude skips GPT plan", model: "claude-sonnet-4-5", plans: []planSpec{special}, wallet: 1000, selected: -1},
				{name: "unrestricted plan accepts GPT", model: "gpt-4o", plans: []planSpec{general}, wallet: 1000, selected: 0},
				{name: "unrestricted plan accepts Claude", model: "claude-sonnet-4-5", plans: []planSpec{general}, wallet: 1000, selected: 0},
				{name: "higher priority restricted plan wins", model: "gpt-4o", plans: []planSpec{general, special}, wallet: 1000, selected: 1},
				{name: "higher priority unrestricted plan wins", model: "gpt-4o", plans: []planSpec{special, {"", 1000, 30}}, wallet: 1000, selected: 1},
				{name: "skip mismatched higher priority plan", model: "gpt-4o", plans: []planSpec{{"14", 1000, 30}, general, special}, wallet: 1000, selected: 2},
				{name: "unit-rate shortage skips to unrestricted plan", model: "gpt-4o", plans: []planSpec{{"1", 50, 30}, general}, wallet: 1000, selected: 1},
				{name: "unit-rate shortage falls back to discounted wallet", model: "gpt-4o", plans: []planSpec{{"1", 50, 30}}, wallet: 36, selected: -1},
				{name: "no subscriptions sufficient wallet", model: "gpt-4o", wallet: 1000, selected: -1},
				{name: "no subscriptions insufficient wallet", model: "gpt-4o", wallet: 35, selected: -1, rejected: true},
				{name: "no subscriptions empty wallet", model: "gpt-4o", selected: -1, rejected: true},
				{name: "restricted plan works with insufficient wallet", model: "gpt-4o", plans: []planSpec{special}, wallet: 1, selected: 0},
				{name: "unrestricted plan works with empty wallet", model: "claude-sonnet-4-5", plans: []planSpec{general}, selected: 0},
				{name: "mismatched plan and insufficient wallet", model: "claude-sonnet-4-5", plans: []planSpec{special}, wallet: 35, selected: -1, rejected: true},
				{name: "all plans and wallet insufficient", model: "gpt-4o", plans: []planSpec{{"1", 50, 30}, {"", 20, 10}}, wallet: 35, selected: -1, rejected: true},
				{name: "token shortage rolls back unit-rate subscription", model: "gpt-4o", plans: []planSpec{special}, wallet: 1000, selected: 0, rejected: true, tokenInsufficient: true},
				{name: "failed request refunds unit-rate subscription once", model: "gpt-4o", plans: []planSpec{special}, wallet: 1000, selected: 0, refund: true},
				{name: "retry preserves unit rate", model: "gpt-4o", plans: []planSpec{special}, wallet: 1000, selected: 0, retry: true},
				{name: "user-specific group discount is ignored for restricted plan", model: "gpt-4o", plans: []planSpec{special}, wallet: 1000, selected: 0, specialGroup: true},
				{name: "zero group ratio cannot make restricted plan free", model: "gpt-4o", plans: []planSpec{special}, selected: 0, freeGroup: true},
				{name: "unrestricted plan retains free group even with empty API token", model: "gpt-4o", plans: []planSpec{general}, selected: 0, freeGroup: true, emptyToken: true},
				{name: "free wallet without subscription needs no billing session", model: "gpt-4o", selected: -1, freeGroup: true, emptyToken: true},
				{name: "mismatched plan falls back to free wallet", model: "claude-sonnet-4-5", plans: []planSpec{special}, selected: -1, freeGroup: true, emptyToken: true},
				{name: "realtime restricted plan with empty wallet", model: "gpt-4o", plans: []planSpec{special}, selected: 0, realtime: true},
				{name: "realtime unrestricted plan with empty wallet", model: "gpt-4o", plans: []planSpec{general}, selected: 0, realtime: true},
				{name: "realtime wallet retains group rate", model: "gpt-4o", wallet: 1000, selected: -1, realtime: true},
				{name: "task restricted plan retains frozen rate", model: "gpt-4o", plans: []planSpec{special}, selected: 0, task: true},
				{name: "task unrestricted plan retains group rate", model: "gpt-4o", plans: []planSpec{general}, selected: 0, task: true},
			} {
				if tc.task && mode != "ratio" {
					continue // Legacy token recalculation is not used for fixed or expression-priced tasks.
				}
				t.Run(tc.name, func(t *testing.T) {
					db := subscriptionBillingDB(t, true)
					require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
						"billing_setting.billing_mode": "{}", "billing_setting.billing_expr": "{}",
						"group_ratio_setting.group_ratio":       `{"subscription-test":0.36,"retry-test":0.12}`,
						"group_ratio_setting.group_group_ratio": "{}",
						"quota_setting.pre_consume_multiplier":  "1", "quota_setting.enable_free_model_pre_consume": "false",
					}))
					if tc.specialGroup {
						require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"group_ratio_setting.group_ratio": `{"subscription-test":0.7}`, "group_ratio_setting.group_group_ratio": `{"subscription-user":{"subscription-test":0.36}}`}))
					}
					if tc.freeGroup {
						require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{"group_ratio_setting.group_ratio": `{"subscription-test":0}`}))
					}
					// Override each model explicitly so published model prices never affect the fixture.
					priceSettings := map[string]string{"ModelPrice": "{}", "ModelRatio": fmt.Sprintf(`{%q:1}`, tc.model), "CompletionRatio": fmt.Sprintf(`{%q:1}`, tc.model)}
					switch mode {
					case "per_call":
						priceSettings["ModelPrice"] = fmt.Sprintf(`{%q:0.0002}`, tc.model)
					case "tiered_token", "tiered_fixed":
						expr := `tier("base", p * 2)`
						if mode == "tiered_fixed" {
							expr = `tier("request", fixed(0.0002))`
						}
						modes, err := common.Marshal(map[string]string{tc.model: "tiered_expr"})
						require.NoError(t, err)
						exprs, err := common.Marshal(map[string]string{tc.model: expr})
						require.NoError(t, err)
						priceSettings["billing_setting.billing_mode"], priceSettings["billing_setting.billing_expr"] = string(modes), string(exprs)
					}
					// Ratio maps are legacy global options rather than the config registry.
					oldPrice, oldRatio, oldCompletion := ratio_setting.ModelPrice2JSONString(), ratio_setting.ModelRatio2JSONString(), ratio_setting.CompletionRatio2JSONString()
					t.Cleanup(func() {
						require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(oldPrice))
						require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(oldRatio))
						require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(oldCompletion))
					})
					require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(priceSettings["ModelPrice"]))
					require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(priceSettings["ModelRatio"]))
					require.NoError(t, ratio_setting.UpdateCompletionRatioByJSONString(priceSettings["CompletionRatio"]))
					delete(priceSettings, "ModelPrice")
					delete(priceSettings, "ModelRatio")
					delete(priceSettings, "CompletionRatio")
					require.NoError(t, config.GlobalConfig.LoadFromDB(priceSettings))
					user := model.User{Username: "subscription-rate", Quota: tc.wallet, Status: common.UserStatusEnabled, Group: "subscription-user"}
					require.NoError(t, db.Create(&user).Error)
					t.Cleanup(func() {
						require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&model.Log{}).Error)
						require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&model.SubscriptionPreConsumeRecord{}).Error)
						require.NoError(t, db.Where("user_id = ?", user.Id).Delete(&model.UserSubscription{}).Error)
						require.NoError(t, db.Unscoped().Where("user_id = ?", user.Id).Delete(&model.Token{}).Error)
						require.NoError(t, db.Unscoped().Delete(&user).Error)
					})
					tokenQuota := 1000
					if tc.tokenInsufficient {
						tokenQuota = 50
					}
					if tc.emptyToken {
						tokenQuota = 0
					}
					token := model.Token{UserId: user.Id, Key: "subscription-rate-token", RemainQuota: tokenQuota, Status: common.TokenStatusEnabled}
					require.NoError(t, db.Create(&token).Error)
					channel := model.Channel{Type: constant.ChannelTypeOpenAI, Name: "subscription-rate"}
					require.NoError(t, db.Create(&channel).Error)
					t.Cleanup(func() { require.NoError(t, db.Delete(&channel).Error) })
					var subs []model.UserSubscription
					for _, spec := range tc.plans {
						plan := model.SubscriptionPlan{Title: "rate plan", AllowedChannelTypes: spec.allowed, QuotaResetPeriod: model.SubscriptionResetNever}
						require.NoError(t, db.Create(&plan).Error)
						model.InvalidateSubscriptionPlanCache(plan.Id)
						t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id); require.NoError(t, db.Delete(&plan).Error) })
						now := model.GetDBTimestamp()
						sub := model.UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "active", StartTime: now - 60, EndTime: now + 3600, AmountTotal: spec.quota, UserPriority: spec.priority}
						require.NoError(t, db.Create(&sub).Error)
						subs = append(subs, sub)
					}
					c, _ := gin.CreateTestContext(httptest.NewRecorder())
					c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
					info := &relaycommon.RelayInfo{RequestId: fmt.Sprintf("subscription-rate-%d", user.Id), UserId: user.Id, TokenId: token.Id, TokenKey: token.Key, OriginModelName: tc.model, UsingGroup: "subscription-test", UserGroup: "subscription-user", ForcePreConsume: true, UserSetting: dto.UserSetting{QuotaWarningThreshold: -1}, StartTime: time.Now(), ChannelMeta: &relaycommon.ChannelMeta{ChannelId: channel.Id, ChannelType: constant.ChannelTypeOpenAI}}
					info.BillingRequestInput = &billingexpr.RequestInput{}
					price, err := helper.ModelPriceHelper(c, info, 101, &kittypes.TokenCountMeta{})
					require.NoError(t, err)
					apiErr := service.PreConsumeBilling(c, price.QuotaToPreConsume, info)
					wantedRate := 0.36
					if tc.freeGroup {
						wantedRate = 0
					}
					if tc.selected >= 0 && tc.plans[tc.selected].allowed != "" {
						wantedRate = 1
					}
					baseEstimate, baseActual := 101, 81
					if tc.realtime {
						baseActual = 181
					}
					if mode == "per_call" || mode == "tiered_fixed" {
						baseEstimate, baseActual = 100, 100
					}
					expectedCharge := baseActual
					expectedReserve := baseEstimate
					if wantedRate != 1 {
						expectedCharge = 29
						expectedReserve = 36
						if baseActual == 100 {
							expectedCharge = 36
						}
						if baseActual == 181 {
							expectedCharge = 65
						}
					}
					if wantedRate == 0 {
						expectedCharge, expectedReserve = 0, 0
					}
					if tc.rejected {
						require.NotNil(t, apiErr)
						if tc.tokenInsufficient {
							assert.Equal(t, kittypes.ErrorCodePreConsumeTokenQuotaFailed, apiErr.GetErrorCode())
						} else {
							assert.Equal(t, kittypes.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
						}
						expectedCharge = 0
						require.Nil(t, info.Billing)
					} else {
						require.Nil(t, apiErr)
						if wantedRate == 0 && tc.selected < 0 {
							require.Nil(t, info.Billing)
						} else {
							require.NotNil(t, info.Billing)
						}
						assert.Equal(t, expectedReserve, info.FinalPreConsumedQuota)
						assert.Equal(t, wantedRate, info.PriceData.GroupRatioInfo.GroupRatio)
						if tc.selected >= 0 {
							assert.Equal(t, subs[tc.selected].Id, info.SubscriptionId)
						} else if info.Billing != nil {
							assert.Equal(t, service.BillingSourceWallet, info.BillingSource)
						}
						if tc.retry {
							c.Set("auto_group", "retry-test")
							info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)
							require.Nil(t, service.PrepareTieredBillingForSelectedGroup(c, info))
							assert.Equal(t, 1.0, info.PriceData.GroupRatioInfo.GroupRatio)
							assert.Equal(t, expectedReserve, info.FinalPreConsumedQuota)
						}
						if tc.refund {
							info.Billing.Refund(c)
							info.Billing.Refund(c)
							require.Eventually(t, func() bool {
								var persisted model.Token
								return db.First(&persisted, token.Id).Error == nil && persisted.RemainQuota == tokenQuota
							}, time.Second, 10*time.Millisecond)
							expectedCharge = 0
						} else if tc.task {
							require.NoError(t, db.AutoMigrate(&model.Task{}))
							require.NoError(t, service.SettleBilling(c, info, expectedReserve))
							task := model.Task{TaskID: info.RequestId, UserId: user.Id, ChannelId: channel.Id, Quota: expectedReserve, Group: info.UsingGroup,
								PrivateData: model.TaskPrivateData{BillingSource: info.BillingSource, SubscriptionId: info.SubscriptionId, TokenId: token.Id,
									BillingContext: &model.TaskBillingContext{GroupRatio: wantedRate, ModelRatio: 1, OriginModelName: tc.model}}}
							require.NoError(t, db.Create(&task).Error)
							t.Cleanup(func() { require.NoError(t, db.Delete(&task).Error) })
							require.True(t, service.RecalculateTaskQuotaByTokens(c, &task, 81))
							require.NoError(t, db.First(&task, task.ID).Error)
							assert.Equal(t, expectedCharge, task.Quota)
						} else {
							if tc.realtime {
								usage := &dto.RealtimeUsage{}
								for _, total := range []int{60, 181} {
									usage.TotalTokens, usage.InputTokens, usage.InputTokenDetails.TextTokens = total, total, total
									require.NoError(t, service.PreWssConsumeQuota(c, info, usage))
								}
								service.PostWssConsumeQuota(c, info, tc.model, usage, "")
							} else {
								service.PostTextConsumeQuota(c, info, &dto.Usage{PromptTokens: 81, TotalTokens: 81}, nil)
							}
							var log model.Log
							require.NoError(t, db.Where("user_id = ?", user.Id).First(&log).Error)
							assert.Equal(t, expectedCharge, log.Quota)
							var other map[string]any
							require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
							assert.Equal(t, wantedRate, other["group_ratio"])
							if info.Billing == nil {
								assert.NotContains(t, other, "billing_source")
							} else {
								assert.Equal(t, info.BillingSource, other["billing_source"])
							}
						}
					}
					require.NoError(t, db.First(&user, user.Id).Error)
					require.NoError(t, db.First(&token, token.Id).Error)
					walletCharge := 0
					if tc.selected < 0 {
						walletCharge = expectedCharge
					}
					assert.Equal(t, tc.wallet-walletCharge, user.Quota)
					assert.Equal(t, tokenQuota-expectedCharge, token.RemainQuota)
					for i, sub := range subs {
						require.NoError(t, db.First(&sub, sub.Id).Error)
						used := 0
						if i == tc.selected {
							used = expectedCharge
						}
						assert.EqualValues(t, used, sub.AmountUsed)
					}
				})
			}
		})
	}
}
