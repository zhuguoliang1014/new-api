package controller

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestProcessChannelErrorUsesSnapshotWithoutLeakingChannelMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousDB, previousLogDB := model.DB, model.LOG_DB
	previousRedisEnabled := common.RedisEnabled
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	previousErrorLogEnabled := constant.ErrorLogEnabled

	database, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	require.NoError(t, database.AutoMigrate(&model.User{}, &model.Log{}))
	model.DB, model.LOG_DB = database, database
	common.RedisEnabled = false
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	constant.ErrorLogEnabled = true
	t.Cleanup(func() {
		model.DB, model.LOG_DB = previousDB, previousLogDB
		common.RedisEnabled = previousRedisEnabled
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		constant.ErrorLogEnabled = previousErrorLogEnabled
		require.NoError(t, sqlDB.Close())
	})

	require.NoError(t, database.Create(&model.User{Id: 7, Username: "log-owner", Group: "default"}).Error)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Set("id", 7)
	ctx.Set("username", "log-owner")
	ctx.Set("token_name", "test-token")
	ctx.Set("token_id", 11)
	ctx.Set("original_model", "gpt-test")
	ctx.Set("group", "default")
	ctx.Set("channel_id", 202)
	ctx.Set("channel_name", "mutable-context-channel")
	ctx.Set("channel_type", 9)
	ctx.Set("use_channel", []string{"101"})
	common.SetContextKey(ctx, constant.ContextKeyRequestStartTime, time.Now().Add(-time.Second))

	channelSnapshot := types.ChannelError{
		ChannelId:   101,
		ChannelType: 1,
		ChannelName: "snapshot-channel",
		AutoBan:     false,
	}
	apiErr := types.NewOpenAIError(errors.New("upstream failed"), types.ErrorCodeBadResponseStatusCode, http.StatusBadGateway)

	processChannelError(ctx, channelSnapshot, apiErr, nil)

	var stored model.Log
	require.NoError(t, database.First(&stored).Error)
	assert.Equal(t, channelSnapshot.ChannelId, stored.ChannelId)
	storedOther, err := common.StrToMap(stored.Other)
	require.NoError(t, err)
	assert.Equal(t, float64(http.StatusBadGateway), storedOther["status_code"])
	for _, key := range []string{"channel_id", "channel_name", "channel_type"} {
		assert.NotContains(t, storedOther, key)
	}
	adminInfo, ok := storedOther["admin_info"].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, []any{"101"}, adminInfo["use_channel"])

	logs, total, err := model.GetUserLogs(7, model.LogFilter{Type: model.LogTypeError}, 0, 10)
	require.NoError(t, err)
	require.Equal(t, int64(1), total)
	require.Len(t, logs, 1)
	assert.Equal(t, channelSnapshot.ChannelId, logs[0].ChannelId)
	assert.Empty(t, logs[0].ChannelName)
	userOther, err := common.StrToMap(logs[0].Other)
	require.NoError(t, err)
	assert.NotContains(t, userOther, "admin_info")
	for _, key := range []string{"channel_id", "channel_name", "channel_type"} {
		assert.NotContains(t, userOther, key)
	}
}

func TestCommonLogIPVisibilityFollowsViewerRole(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	user := model.User{Username: "ip-log-owner", AffCode: "ip-log-owner", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1}
	require.NoError(t, db.Create(&user).Error)
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	ctx.Request.RemoteAddr = "203.0.113.42:54321"
	ctx.Set("id", user.Id)
	ctx.Set("username", user.Username)
	model.RecordErrorLog(ctx, user.Id, 0, "gpt-test", "test-key", "upstream failed", 1, 1, false, "default", model.NewLogOther())
	previousConsumeLog := common.LogConsumeEnabled
	common.LogConsumeEnabled = true
	t.Cleanup(func() { common.LogConsumeEnabled = previousConsumeLog })
	model.RecordConsumeLog(ctx, user.Id, model.RecordConsumeLogParams{
		ModelName: "gpt-test", TokenName: "test-key", Other: model.NewLogOther(),
	})

	var stored model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ? AND type = ?", user.Id, model.LogTypeError).First(&stored).Error)
	assert.Equal(t, "203.0.113.42", stored.Ip)
	var consume model.Log
	require.NoError(t, model.LOG_DB.Where("user_id = ? AND type = ?", user.Id, model.LogTypeConsume).First(&consume).Error)
	assert.Equal(t, "203.0.113.42", consume.Ip)
	userResult := callLogHandler(t, GetUserLogs, user.Id, common.RoleCommonUser, "type=5")[0]
	require.Equal(t, true, userResult["success"])
	items := userResult["data"].(map[string]any)["items"].([]any)
	require.Len(t, items, 1)
	assert.Empty(t, items[0].(map[string]any)["ip"])
	adminResult := callLogHandler(t, GetAllLogs, user.Id, common.RoleAdminUser, "type=5")[0]
	adminItems := adminResult["data"].(map[string]any)["items"].([]any)
	require.Len(t, adminItems, 1)
	assert.Equal(t, "203.0.113.42", adminItems[0].(map[string]any)["ip"])
	adminSelf := callLogHandler(t, GetUserLogs, user.Id, common.RoleAdminUser, "type=5")[0]
	adminSelfItems := adminSelf["data"].(map[string]any)["items"].([]any)
	assert.Equal(t, "203.0.113.42", adminSelfItems[0].(map[string]any)["ip"])
	require.NoError(t, db.Model(&user).Update("setting", `{"record_ip_log":true}`).Error)
	userResult = callLogHandler(t, GetUserLogs, user.Id, common.RoleCommonUser, "type=5")[0]
	items = userResult["data"].(map[string]any)["items"].([]any)
	assert.Equal(t, "203.0.113.42", items[0].(map[string]any)["ip"])
	logSetting := operation_setting.GetLogSetting()
	previousExport := logSetting.UserExportEnabled
	logSetting.UserExportEnabled = true
	t.Cleanup(func() { logSetting.UserExportEnabled = previousExport })
	userExport := callLogHandler(t, ExportUserLogs, user.Id, common.RoleCommonUser, "type=5")
	require.Len(t, userExport, 2)
	assert.Equal(t, "203.0.113.42", userExport[0]["ip"])
	require.NoError(t, db.Model(&user).Update("setting", `{}`).Error)
	userExport = callLogHandler(t, ExportUserLogs, user.Id, common.RoleCommonUser, "type=5")
	require.Len(t, userExport, 2)
	assert.Empty(t, userExport[0]["ip"])
	assert.False(t, canViewOwnLogIP(user.Id, 0))
	require.NoError(t, db.Model(&user).Update("role", common.RoleAdminUser).Error)
	assert.True(t, canViewOwnLogIP(user.Id, 0))
}
