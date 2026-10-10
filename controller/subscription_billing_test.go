package controller

import (
	"bytes"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
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
	oldMaster := common.IsMasterNode
	t.Setenv("LOG_SQL_DSN", "")
	common.SetDatabaseTypes(dialect, dialect)
	common.IsMasterNode = false
	common.RedisEnabled, common.BatchUpdateEnabled, common.MemoryCacheEnabled = false, false, false
	t.Cleanup(func() {
		if useTransaction {
			require.NoError(t, db.Rollback().Error)
		}
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.LogConsumeEnabled, common.DataExportEnabled = oldConsume, oldExport
		common.SetDatabaseTypes(oldMain, oldLog)
		require.NoError(t, model.InitLogDB())
		model.LOG_DB = oldLogDB
		common.SetDatabaseTypes(oldMain, oldLog)
		common.IsMasterNode = oldMaster
		common.RedisEnabled, common.BatchUpdateEnabled, common.MemoryCacheEnabled = oldRedis, oldBatch, oldMemory
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.SubscriptionPreConsumeRecord{}, &model.Channel{}, &model.Log{}))
	if useTransaction {
		db = db.Begin()
		require.NoError(t, db.Error)
	}
	model.DB, model.LOG_DB = db, db
	// Reuse startup initialization for dialect-specific identifier quoting.
	require.NoError(t, model.InitLogDB())
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
				ratios                                                                          []float64
				changeRatioAfterReserve                                                         bool
				frozenPlans                                                                     []int
				wallet                                                                          int
				selected                                                                        int // -1 = wallet; rejected cases must leave all accounts unchanged.
				rejected, tokenInsufficient, refund, retry, specialGroup, freeGroup, emptyToken bool
				realtime, task, image, imageReserveRejected                                     bool
				freezeAfterReserve, resumeBeforeReserve, taskRefund, taskExtra                  bool
			}{
				{name: "discounted plan applies configured ratio before rounding", model: "gpt-4o", plans: []planSpec{special}, ratios: []float64{0.75}, selected: 0},
				{name: "plan surcharge ignores API group discount", model: "gpt-4o", plans: []planSpec{special}, ratios: []float64{2}, selected: 0, specialGroup: true},
				{name: "configured ratio shortage falls back to wallet", model: "gpt-4o", plans: []planSpec{{"1", 150, 20}}, ratios: []float64{2}, wallet: 1000, selected: -1},
				{name: "selection checks each plan at its own ratio", model: "gpt-4o", plans: []planSpec{{"1", 150, 20}, {"1", 100, 10}}, ratios: []float64{2, 0.75}, selected: 1},
				{name: "unrestricted plan ignores configured ratio", model: "gpt-4o", plans: []planSpec{general}, ratios: []float64{2}, selected: 0},
				{name: "failed configured ratio reservation refunds exactly once", model: "gpt-4o", plans: []planSpec{special}, ratios: []float64{2}, selected: 0, refund: true},
				{name: "configured ratio token shortage rolls back", model: "gpt-4o", plans: []planSpec{special}, ratios: []float64{2}, selected: 0, rejected: true, tokenInsufficient: true},
				{name: "plan update cannot change in-flight retry or replay ratio", model: "gpt-4o", plans: []planSpec{special}, ratios: []float64{0.75}, selected: 0, retry: true, changeRatioAfterReserve: true},
				{name: "realtime retains configured plan ratio", model: "gpt-4o", plans: []planSpec{special}, ratios: []float64{2}, selected: 0, realtime: true},
				{name: "task retains configured plan ratio", model: "gpt-4o", plans: []planSpec{special}, ratios: []float64{0.75}, selected: 0, task: true, changeRatioAfterReserve: true},
				{name: "images retain configured plan ratio for quantity changes", model: "gpt-4o", plans: []planSpec{special}, ratios: []float64{0.75}, selected: 0, image: true},
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
				{name: "frozen restricted plan falls back to wallet at group rate", model: "gpt-4o", plans: []planSpec{special}, frozenPlans: []int{0}, wallet: 1000, selected: -1},
				{name: "frozen unrestricted plan falls back to wallet", model: "gpt-4o", plans: []planSpec{general}, frozenPlans: []int{0}, wallet: 1000, selected: -1},
				{name: "frozen unlimited plan cannot fund requests", model: "gpt-4o", plans: []planSpec{{"", 0, 30}}, frozenPlans: []int{0}, wallet: 1000, selected: -1},
				{name: "skip frozen higher priority restricted plan", model: "gpt-4o", plans: []planSpec{special, general}, frozenPlans: []int{0}, selected: 1},
				{name: "skip frozen higher priority unrestricted plan", model: "gpt-4o", plans: []planSpec{{"", 1000, 30}, special}, frozenPlans: []int{0}, selected: 1},
				{name: "all frozen and empty wallet reject without charging", model: "gpt-4o", plans: []planSpec{special, general}, frozenPlans: []int{0, 1}, selected: -1, rejected: true},
				{name: "all frozen and insufficient wallet reject without charging", model: "gpt-4o", plans: []planSpec{special, general}, frozenPlans: []int{0, 1}, wallet: 35, selected: -1, rejected: true},
				{name: "frozen funded quota cannot rescue exhausted active plan", model: "gpt-4o", plans: []planSpec{special, {"", 20, 10}}, frozenPlans: []int{0}, wallet: 1000, selected: -1},
				{name: "token shortage rolls back active plan without touching frozen plan", model: "gpt-4o", plans: []planSpec{{"", 1000, 30}, special}, frozenPlans: []int{0}, wallet: 1000, selected: 1, tokenInsufficient: true, rejected: true},
				{name: "empty token blocks wallet fallback with frozen plans", model: "gpt-4o", plans: []planSpec{special}, frozenPlans: []int{0}, wallet: 1000, selected: -1, tokenInsufficient: true, emptyToken: true, rejected: true},
				{name: "failed wallet request refunds once without touching frozen plan", model: "gpt-4o", plans: []planSpec{special}, frozenPlans: []int{0}, wallet: 1000, selected: -1, refund: true},
				{name: "resumed plan becomes eligible with previous usage retained", model: "gpt-4o", plans: []planSpec{special}, frozenPlans: []int{0}, selected: 0, resumeBeforeReserve: true},
				{name: "request reserved before freeze settles on original plan through retry", model: "gpt-4o", plans: []planSpec{special}, wallet: 1000, selected: 0, freezeAfterReserve: true, retry: true},
				{name: "request reserved before freeze refunds original plan once", model: "gpt-4o", plans: []planSpec{special}, wallet: 1000, selected: 0, freezeAfterReserve: true, refund: true},
				{name: "realtime new session skips frozen plan", model: "gpt-4o", plans: []planSpec{special}, frozenPlans: []int{0}, wallet: 1000, selected: -1, realtime: true},
				{name: "realtime in-flight session settles after freeze", model: "gpt-4o", plans: []planSpec{special}, selected: 0, freezeAfterReserve: true, realtime: true},
				{name: "task submission skips frozen plan", model: "gpt-4o", plans: []planSpec{special}, frozenPlans: []int{0}, wallet: 1000, selected: -1, task: true},
				{name: "in-flight task refunds excess reservation after freeze", model: "gpt-4o", plans: []planSpec{special}, selected: 0, freezeAfterReserve: true, task: true},
				{name: "in-flight task charges additional usage after freeze", model: "gpt-4o", plans: []planSpec{special}, selected: 0, freezeAfterReserve: true, task: true, taskExtra: true},
				{name: "failed in-flight task refunds once after freeze", model: "gpt-4o", plans: []planSpec{special}, selected: 0, freezeAfterReserve: true, task: true, taskRefund: true},
				{name: "image request skips frozen plan and reserves wallet quantity", model: "gpt-4o", plans: []planSpec{special}, frozenPlans: []int{0}, wallet: 1000, selected: -1, image: true},
				{name: "image request skips frozen plan and reserves active plan quantity", model: "gpt-4o", plans: []planSpec{special, general}, frozenPlans: []int{0}, selected: 1, image: true},
				{name: "in-flight images retain original plan after freeze and count increase", model: "gpt-4o", plans: []planSpec{special}, selected: 0, freezeAfterReserve: true, image: true},
				{name: "failed in-flight images refund original and extra reservations after freeze", model: "gpt-4o", plans: []planSpec{special}, selected: 0, freezeAfterReserve: true, image: true, refund: true},
				{name: "image override cannot use frozen quota to cover wallet shortage", model: "gpt-4o", plans: []planSpec{special}, frozenPlans: []int{0}, wallet: 100, selected: -1, image: true, imageReserveRejected: true, refund: true},
			} {
				if tc.task && mode != "ratio" {
					continue // Legacy token recalculation is not used for fixed or expression-priced tasks.
				}
				if tc.image && mode != "per_call" && mode != "tiered_fixed" {
					continue // These cases exercise quantity-priced images.
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
							if tc.image {
								expr += " * image_count"
							}
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
					for i, spec := range tc.plans {
						plan := model.SubscriptionPlan{Title: "rate plan", AllowedChannelTypes: spec.allowed, QuotaResetPeriod: model.SubscriptionResetNever}
						if i < len(tc.ratios) {
							plan.BillingRatio = &tc.ratios[i]
						}
						require.NoError(t, db.Create(&plan).Error)
						model.InvalidateSubscriptionPlanCache(plan.Id)
						t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id); require.NoError(t, db.Delete(&plan).Error) })
						now := model.GetDBTimestamp()
						sub := model.UserSubscription{UserId: user.Id, PlanId: plan.Id, Status: "active", StartTime: now - 60, EndTime: now + 3600, AmountTotal: spec.quota, UserPriority: spec.priority}
						if slices.Contains(tc.frozenPlans, i) {
							sub.Status, sub.FrozenAt, sub.AmountUsed = "frozen", now-60, 17
						}
						require.NoError(t, db.Create(&sub).Error)
						subs = append(subs, sub)
					}
					if tc.resumeBeforeReserve {
						_, err := model.SetUserSubscriptionFrozen(user.Id, subs[tc.selected].Id, false)
						require.NoError(t, err)
					}
					c, _ := gin.CreateTestContext(httptest.NewRecorder())
					c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
					info := &relaycommon.RelayInfo{RequestId: fmt.Sprintf("subscription-rate-%d", user.Id), UserId: user.Id, TokenId: token.Id, TokenKey: token.Key, OriginModelName: tc.model, UsingGroup: "subscription-test", UserGroup: "subscription-user", ForcePreConsume: true, UserSetting: dto.UserSetting{QuotaWarningThreshold: -1}, StartTime: time.Now(), ChannelMeta: &relaycommon.ChannelMeta{ChannelId: channel.Id, ChannelType: constant.ChannelTypeOpenAI}}
					info.BillingRequestInput = &billingexpr.RequestInput{}
					if tc.image {
						info.ImageRequestCount = 1
						info.BillingRequestInput.ImageCount = common.GetPointer(1)
						c.Request.URL.Path = "/v1/images/generations"
					}
					price, err := helper.ModelPriceHelper(c, info, 101, &kittypes.TokenCountMeta{})
					require.NoError(t, err)
					apiErr := service.PreConsumeBilling(c, price.QuotaToPreConsume, info)
					wantedRate := 0.36
					if tc.freeGroup {
						wantedRate = 0
					}
					if tc.selected >= 0 && tc.plans[tc.selected].allowed != "" {
						wantedRate = 1
						if tc.selected < len(tc.ratios) {
							wantedRate = tc.ratios[tc.selected]
						}
					}
					baseEstimate, baseActual := 101, 81
					if tc.realtime {
						baseActual = 181
					}
					if tc.taskExtra {
						baseActual = 181
					}
					if mode == "per_call" || mode == "tiered_fixed" {
						baseEstimate, baseActual = 100, 100
					}
					if tc.image {
						baseActual = 200 // Two delivered images, three reserved before submission.
					}
					expectedCharge := common.QuotaRound(float64(baseActual) * wantedRate)
					if tc.task {
						expectedCharge = common.QuotaFromFloat(float64(baseActual) * wantedRate)
					}
					expectedReserve := common.QuotaFromFloat(float64(baseEstimate) * wantedRate)
					if strings.HasPrefix(mode, "tiered_") {
						expectedReserve = common.QuotaRound(float64(baseEstimate) * wantedRate)
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
						if tc.freezeAfterReserve {
							// The holiday transition itself is exercised by the model
							// tests. Here switch state at the real billing boundary.
							require.NoError(t, db.Model(&model.UserSubscription{}).Where("id = ?", subs[tc.selected].Id).
								Updates(map[string]any{"status": "frozen", "frozen_at": common.GetTimestamp()}).Error)
						}
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
						if tc.changeRatioAfterReserve {
							planID := subs[tc.selected].PlanId
							require.NoError(t, db.Model(&model.SubscriptionPlan{}).Where("id = ?", planID).Update("billing_ratio", 3).Error)
							model.InvalidateSubscriptionPlanCache(planID)
							replayed, err := model.PreConsumeUserSubscriptionWithGroupQuota(info.RequestId, user.Id, tc.model, 36, 101)
							require.NoError(t, err)
							assert.Equal(t, wantedRate, replayed.BillingRatio)
							assert.EqualValues(t, expectedReserve, replayed.PreConsumed)
						}
						if tc.retry {
							c.Set("auto_group", "retry-test")
							info.PriceData.GroupRatioInfo = helper.HandleGroupRatio(c, info)
							require.Nil(t, service.PrepareTieredBillingForSelectedGroup(c, info))
							assert.Equal(t, wantedRate, info.PriceData.GroupRatioInfo.GroupRatio)
							assert.Equal(t, expectedReserve, info.FinalPreConsumedQuota)
						}
						if tc.image {
							reserveErr := service.PrepareImageBillingForRequest(c, info, 3)
							if tc.imageReserveRejected {
								require.NotNil(t, reserveErr)
								assert.Equal(t, kittypes.ErrorCodeInsufficientUserQuota, reserveErr.GetErrorCode())
								assert.Equal(t, expectedReserve, info.Billing.GetPreConsumedQuota())
							} else {
								require.Nil(t, reserveErr)
								assert.Equal(t, expectedReserve*3, info.Billing.GetPreConsumedQuota())
								info.UpdateImageCount(2)
							}
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
							info.TaskRelayInfo = &relaycommon.TaskRelayInfo{Action: "generate"}
							// RelayTask records the submission's final quota before logging it.
							info.PriceData.Quota = expectedReserve
							require.NoError(t, service.SettleBilling(c, info, expectedReserve))
							task := model.Task{TaskID: info.RequestId, UserId: user.Id, ChannelId: channel.Id, Quota: expectedReserve, Group: info.UsingGroup,
								PrivateData: model.TaskPrivateData{BillingSource: info.BillingSource, SubscriptionId: info.SubscriptionId, TokenId: token.Id,
									BillingContext: &model.TaskBillingContext{SubscriptionUsesPlanRatio: common.GetPointer(info.SubscriptionUsesPlanRatio), GroupRatio: wantedRate, ModelRatio: 1, OriginModelName: tc.model}}}
							require.NoError(t, db.Create(&task).Error)
							t.Cleanup(func() { require.NoError(t, db.Delete(&task).Error) })
							service.LogTaskConsumption(c, info, &task)
							if tc.taskRefund {
								require.True(t, service.RefundTaskQuota(c, &task, "upstream failed while subscription frozen"))
								require.True(t, service.RefundTaskQuota(c, &task, "duplicate failure notification"))
								expectedCharge = 0
							} else {
								require.True(t, service.RecalculateTaskQuotaByTokens(c, &task, baseActual))
								service.RecalculateTaskQuotaByTokens(c, &task, baseActual)
							}
							require.NoError(t, db.First(&task, task.ID).Error)
							assert.Equal(t, expectedCharge, task.Quota)
							require.NotNil(t, task.PrivateData.BillingContext.SubscriptionUsesPlanRatio)
							assert.Equal(t, info.SubscriptionUsesPlanRatio, *task.PrivateData.BillingContext.SubscriptionUsesPlanRatio)
							var log model.Log
							logQuery := db.Where("user_id = ?", user.Id)
							if tc.taskRefund {
								logQuery = logQuery.Where("type = ?", model.LogTypeRefund)
							}
							require.NoError(t, logQuery.Order("id desc").First(&log).Error)
							logQuota := expectedCharge - expectedReserve
							if logQuota < 0 {
								logQuota = -logQuota
							}
							assert.Equal(t, logQuota, log.Quota)
							var logCount int64
							require.NoError(t, db.Model(&model.Log{}).Where("user_id = ?", user.Id).Count(&logCount).Error)
							assert.EqualValues(t, 2, logCount, "submission and one adjustment log, including after duplicate callbacks")
							var other map[string]any
							require.NoError(t, common.UnmarshalJsonStr(log.Other, &other))
							assert.Equal(t, info.BillingSource, other["billing_source"])
							assert.Equal(t, wantedRate, other["billing_group_ratio"])
							if info.SubscriptionUsesPlanRatio {
								assert.Equal(t, "subscription_plan", other["billing_ratio_source"])
							} else {
								assert.Equal(t, "api_group", other["billing_ratio_source"])
							}
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
							if tc.freezeAfterReserve {
								require.NoError(t, info.Billing.Settle(expectedCharge))
								info.Billing.Refund(c)
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
								assert.Equal(t, wantedRate, other["billing_group_ratio"])
								if info.SubscriptionUsesPlanRatio {
									assert.Equal(t, "subscription_plan", other["billing_ratio_source"])
								} else {
									assert.Equal(t, "api_group", other["billing_ratio_source"])
								}
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
					if tc.task {
						assert.Equal(t, expectedCharge, user.UsedQuota)
						assert.Equal(t, 1, user.RequestCount, "task completion/refund must not create additional requests")
						require.NoError(t, db.First(&channel, channel.Id).Error)
						assert.EqualValues(t, expectedCharge, channel.UsedQuota)
					}
					for i, sub := range subs {
						require.NoError(t, db.First(&sub, sub.Id).Error)
						used := int(subs[i].AmountUsed)
						if i == tc.selected {
							used += expectedCharge
						}
						assert.EqualValues(t, used, sub.AmountUsed)
						if slices.Contains(tc.frozenPlans, i) && !tc.resumeBeforeReserve || tc.freezeAfterReserve && i == tc.selected {
							assert.Equal(t, "frozen", sub.Status)
						}
					}
				})
			}
		})
	}
}

func TestSetSubscriptionFrozenValidatesRequestAndOwnership(t *testing.T) {
	db := subscriptionBillingDB(t)
	require.NoError(t, db.Create(&model.User{Id: 41, Username: "freeze-api-user", Group: "default", AffCode: "freeze-api"}).Error)
	require.NoError(t, db.Create(&model.User{Id: 42, Username: "freeze-foreign-user", Group: "default", AffCode: "freeze-foreign"}).Error)
	now := model.GetDBTimestamp()
	sub := model.UserSubscription{UserId: 41, PlanId: 1, Status: "frozen", FrozenAt: now - 3600, EndTime: now + 86400, AmountTotal: 1000, AmountUsed: 250}
	require.NoError(t, db.Create(&sub).Error)
	for _, tc := range []struct {
		name, id, body string
		userId         int
		success        bool
	}{
		{"missing desired state", fmt.Sprint(sub.Id), `{}`, 41, false},
		{"null desired state", fmt.Sprint(sub.Id), `{"frozen":null}`, 41, false},
		{"wrong desired state type", fmt.Sprint(sub.Id), `{"frozen":"false"}`, 41, false},
		{"malformed JSON", fmt.Sprint(sub.Id), `{"frozen":`, 41, false},
		{"zero id", "0", `{"frozen":false}`, 41, false},
		{"non-numeric id", "invalid", `{"frozen":false}`, 41, false},
		{"invalid id", "-1", `{"frozen":false}`, 41, false},
		{"missing authenticated user", fmt.Sprint(sub.Id), `{"frozen":false,"user_id":41}`, 0, false},
		{"foreign subscription", fmt.Sprint(sub.Id), `{"frozen":false,"user_id":41}`, 42, false},
		{"resume with untrusted client date", fmt.Sprint(sub.Id), `{"frozen":false,"now":9999999999,"date":"2026-10-01"}`, 41, true},
		{"repeated resume", fmt.Sprint(sub.Id), `{"frozen":false}`, 41, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Set("id", tc.userId)
			c.Params = gin.Params{{Key: "id", Value: tc.id}}
			c.Request = httptest.NewRequest(http.MethodPut, "/api/subscription/self/1/freeze", strings.NewReader(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			SetSubscriptionFrozen(c)
			var response struct {
				Success bool `json:"success"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
			assert.Equal(t, tc.success, response.Success)
			var saved model.UserSubscription
			require.NoError(t, db.First(&saved, sub.Id).Error)
			if !tc.success {
				assert.Equal(t, "frozen", saved.Status)
				assert.Equal(t, sub.EndTime, saved.EndTime)
			} else {
				assert.Equal(t, "active", saved.Status)
				assert.InDelta(t, sub.EndTime+3600, saved.EndTime, 2)
				assert.EqualValues(t, 250, saved.AmountUsed)
			}
		})
	}
}

func TestSubscriptionBillingRatioValidationAndPersistence(t *testing.T) {
	for _, tc := range []struct {
		name, raw string
		valid     bool
		ratio     *float64
	}{
		{"unset", "null", true, nil},
		{"discount", "0.75", true, common.GetPointer(0.75)},
		{"surcharge", "2", true, common.GetPointer(2.0)},
		{"zero", "0", false, nil},
		{"negative", "-1", false, nil},
		{"overflow", "1e999", false, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := subscriptionBillingDB(t)
			confirmPaymentComplianceForTest(t)
			plan := model.SubscriptionPlan{Title: "ratio validation", PriceAmount: 10, PriceCNY: 70, BillingRatio: common.GetPointer(1.5)}
			require.NoError(t, db.Create(&plan).Error)
			t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
			for _, method := range []string{http.MethodPost, http.MethodPut} {
				body := fmt.Sprintf(`{"plan":{"title":"ratio validation","price_amount":10,"price_cny":70,"allowed_channel_types":"1","billing_ratio":%s}}`, tc.raw)
				recorder := httptest.NewRecorder()
				c, _ := gin.CreateTestContext(recorder)
				c.Request = httptest.NewRequest(method, "/api/subscription/admin/plans", strings.NewReader(body))
				c.Request.Header.Set("Content-Type", "application/json")
				if method == http.MethodPut {
					c.Params = gin.Params{{Key: "id", Value: fmt.Sprint(plan.Id)}}
					AdminUpdateSubscriptionPlan(c)
				} else {
					AdminCreateSubscriptionPlan(c)
				}
				var response struct {
					Success bool                   `json:"success"`
					Data    model.SubscriptionPlan `json:"data"`
				}
				require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
				require.Equal(t, tc.valid, response.Success, recorder.Body.String())
				var persisted model.SubscriptionPlan
				id := plan.Id
				if tc.valid && method == http.MethodPost {
					id = response.Data.Id
				}
				require.NoError(t, db.First(&persisted, id).Error)
				want := plan.BillingRatio
				if tc.valid {
					want = tc.ratio
				}
				assert.Equal(t, want, persisted.BillingRatio)
			}
		})
	}
}

func TestSubscriptionBillingRatioRejectsUnsafeCharges(t *testing.T) {
	db := subscriptionBillingDB(t)
	plan := model.SubscriptionPlan{Title: "invalid rate", AllowedChannelTypes: "1", BillingRatio: common.GetPointer(math.MaxFloat64)}
	require.NoError(t, db.Create(&plan).Error)
	t.Cleanup(func() { model.InvalidateSubscriptionPlanCache(plan.Id) })
	sub := model.UserSubscription{UserId: 987, PlanId: plan.Id, Status: "active", EndTime: model.GetDBTimestamp() + 3600}
	require.NoError(t, db.Create(&sub).Error)
	_, err := model.PreConsumeUserSubscriptionWithPricing("ratio-overflow", sub.UserId, "gpt-test", 36, 100, false)
	require.Error(t, err)
	require.NoError(t, db.First(&sub, sub.Id).Error)
	assert.Zero(t, sub.AmountUsed)
	var count int64
	require.NoError(t, db.Model(&model.SubscriptionPreConsumeRecord{}).Count(&count).Error)
	assert.Zero(t, count)
	for _, invalid := range []float64{0, -1, math.NaN(), math.Inf(1)} {
		plan.BillingRatio = &invalid
		_, err := plan.EffectiveBillingRatio()
		assert.Error(t, err)
	}
}

// Schema copied from v1.0.0-rc.43 for the upgrade regression.
type releasedRatioSubscriptionPlan struct {
	Id int `json:"id"`

	Title    string `json:"title" gorm:"type:varchar(128);not null"`
	Subtitle string `json:"subtitle" gorm:"type:varchar(255);default:''"`

	// Display money amount (follow existing code style: float64 for money)
	PriceAmount float64 `json:"price_amount" gorm:"type:decimal(10,6);not null;default:0"`
	Currency    string  `json:"currency" gorm:"type:varchar(8);not null;default:'USD'"`

	DurationUnit  string `json:"duration_unit" gorm:"type:varchar(16);not null;default:'month'"`
	DurationValue int    `json:"duration_value" gorm:"type:int;not null;default:1"`
	CustomSeconds int64  `json:"custom_seconds" gorm:"type:bigint;not null;default:0"`

	Enabled   bool `json:"enabled" gorm:"default:true"`
	SortOrder int  `json:"sort_order" gorm:"type:int;default:0"`

	AllowBalancePay *bool `json:"allow_balance_pay"`

	// Allow falling back to wallet balance after subscription quota is exhausted (empty = true)
	AllowWalletOverflow *bool `json:"allow_wallet_overflow"`

	StripePriceId         string `json:"stripe_price_id" gorm:"type:varchar(128);default:''"`
	CreemProductId        string `json:"creem_product_id" gorm:"type:varchar(128);default:''"`
	WaffoPancakeProductId string `json:"waffo_pancake_product_id" gorm:"type:varchar(128);default:''"`

	// Max purchases per user (0 = unlimited)
	MaxPurchasePerUser int `json:"max_purchase_per_user" gorm:"type:int;default:0"`

	// Upgrade user group after purchase (empty = no change)
	UpgradeGroup string `json:"upgrade_group" gorm:"type:varchar(64);default:''"`

	// Downgrade user group on expiry (empty = revert to the group held before purchase)
	DowngradeGroup string `json:"downgrade_group" gorm:"type:varchar(64);default:''"`

	// Total quota (amount in quota units, 0 = unlimited)
	TotalAmount int64 `json:"total_amount" gorm:"type:bigint;not null;default:0"`

	// Quota reset period for plan
	QuotaResetPeriod        string `json:"quota_reset_period" gorm:"type:varchar(16);default:'never'"`
	QuotaResetCustomSeconds int64  `json:"quota_reset_custom_seconds" gorm:"type:bigint;default:0"`

	CreatedAt int64 `json:"created_at" gorm:"bigint"`
	UpdatedAt int64 `json:"updated_at" gorm:"bigint"`
}

func (releasedRatioSubscriptionPlan) TableName() string { return "subscription_plans" }

// Schema copied from v1.0.0-rc.43 for the upgrade regression.
type releasedRatioSubscriptionPreConsumeRecord struct {
	Id                 int    `json:"id"`
	RequestId          string `json:"request_id" gorm:"type:varchar(64);uniqueIndex"`
	UserId             int    `json:"user_id" gorm:"index"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"index"`
	PreConsumed        int64  `json:"pre_consumed" gorm:"type:bigint;not null;default:0"`
	Status             string `json:"status" gorm:"type:varchar(32);index"` // consumed/refunded
	CreatedAt          int64  `json:"created_at" gorm:"bigint"`
	UpdatedAt          int64  `json:"updated_at" gorm:"bigint;index"`
}

func (releasedRatioSubscriptionPreConsumeRecord) TableName() string {
	return "subscription_pre_consume_records"
}

func TestSubscriptionBillingRatioMigration(t *testing.T) {
	for _, upgrade := range []bool{false, true} {
		t.Run(fmt.Sprintf("upgrade=%t", upgrade), func(t *testing.T) {
			db := subscriptionBillingDB(t, true)
			if upgrade {
				require.NoError(t, db.Migrator().DropTable(&model.SubscriptionPreConsumeRecord{}, &model.SubscriptionPlan{}))
				require.NoError(t, db.AutoMigrate(&releasedRatioSubscriptionPlan{}, &releasedRatioSubscriptionPreConsumeRecord{}))
			}
			// These rows are written by the released schema in upgrade mode.
			plan := releasedRatioSubscriptionPlan{Title: "existing paid plan", PriceAmount: 9.75, DurationUnit: "day", DurationValue: 30, TotalAmount: 500000, Enabled: true}
			record := releasedRatioSubscriptionPreConsumeRecord{RequestId: "existing-reservation", UserId: 12, UserSubscriptionId: 34, PreConsumed: 123, Status: "consumed"}
			require.NoError(t, db.Create(&plan).Error)
			require.NoError(t, db.Create(&record).Error)
			t.Cleanup(func() {
				require.NoError(t, db.Delete(&record).Error)
				require.NoError(t, db.Delete(&plan).Error)
			})
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.SubscriptionPlan{}, &model.SubscriptionPreConsumeRecord{}))
				var persisted model.SubscriptionPlan
				require.NoError(t, db.First(&persisted, plan.Id).Error)
				assert.Nil(t, persisted.BillingRatio)
				ratio, err := persisted.EffectiveBillingRatio()
				require.NoError(t, err)
				assert.Equal(t, 1.0, ratio)
				assert.Equal(t, plan.Title, persisted.Title)
				assert.Equal(t, plan.PriceAmount, persisted.PriceAmount)
				assert.Equal(t, plan.TotalAmount, persisted.TotalAmount)
				assert.True(t, persisted.Enabled)
				assert.Equal(t, plan.DurationValue, persisted.DurationValue)
				var reservation model.SubscriptionPreConsumeRecord
				require.NoError(t, db.First(&reservation, record.Id).Error)
				assert.Nil(t, reservation.BillingRatio)
				assert.Equal(t, record.PreConsumed, reservation.PreConsumed)
				assert.Equal(t, record.Status, reservation.Status)
				for _, field := range []string{"UserId", "UserSubscriptionId", "Status", "UpdatedAt"} {
					assert.True(t, db.Migrator().HasIndex(&model.SubscriptionPreConsumeRecord{}, field))
				}
				duplicate := model.SubscriptionPreConsumeRecord{RequestId: record.RequestId}
				assert.Error(t, db.Create(&duplicate).Error, "request id must remain unique")
			}
			var version string
			query := "SELECT version()"
			if db.Dialector.Name() == "sqlite" {
				query = "SELECT sqlite_version()"
			}
			require.NoError(t, db.Raw(query).Scan(&version).Error)
			t.Logf("database=%s version=%s", db.Dialector.Name(), version)
		})
	}
}
