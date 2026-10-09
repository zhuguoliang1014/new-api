package controller

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/mysql"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func subscriptionBillingDB(t *testing.T) *gorm.DB {
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
	oldDB := model.DB
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	oldRedis, oldBatch, oldMemory := common.RedisEnabled, common.BatchUpdateEnabled, common.MemoryCacheEnabled
	common.SetDatabaseTypes(dialect, oldLog)
	common.RedisEnabled, common.BatchUpdateEnabled, common.MemoryCacheEnabled = false, false, false
	t.Cleanup(func() {
		require.NoError(t, db.Rollback().Error)
		model.DB = oldDB
		common.SetDatabaseTypes(oldMain, oldLog)
		common.RedisEnabled, common.BatchUpdateEnabled, common.MemoryCacheEnabled = oldRedis, oldBatch, oldMemory
		require.NoError(t, sqlDB.Close())
	})
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Token{}, &model.SubscriptionPlan{}, &model.UserSubscription{}, &model.SubscriptionPreConsumeRecord{}))
	db = db.Begin()
	require.NoError(t, db.Error)
	model.DB = db
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
