package router

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestHomepageModelsRoutesProtectConfigAndPublishSelectedMetadata(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousDB, previousLogDB, previousRedis := model.DB, model.LOG_DB, common.RedisEnabled
	common.OptionMapRWMutex.Lock()
	previousOptions := common.OptionMap
	common.OptionMap = map[string]string{"HeaderNavModules": `{"pricing":{"enabled":false,"requireAuth":true}}`}
	common.OptionMapRWMutex.Unlock()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.User{}, &model.Model{}, &model.Vendor{}, &model.Option{}, &model.AuditLog{}))
	model.DB, model.LOG_DB, common.RedisEnabled = db, db, false
	require.NoError(t, model.EnsureLegacyAccessTokenRetireAt(time.Now().Unix()))
	t.Cleanup(func() {
		model.DB, model.LOG_DB, common.RedisEnabled = previousDB, previousLogDB, previousRedis
		common.OptionMapRWMutex.Lock()
		common.OptionMap = previousOptions
		common.OptionMapRWMutex.Unlock()
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	for _, role := range []int{common.RoleCommonUser, common.RoleAdminUser, common.RoleRootUser} {
		token := "homepage-test-role-" + common.Interface2String(role)
		user := model.User{Username: "homepage-user-" + common.Interface2String(role), Password: "unused-hash", Role: role, Status: common.UserStatusEnabled, Group: "default", AuthVersion: 1, AffCode: "homepage-aff-" + common.Interface2String(role)}
		user.SetAccessToken(token)
		require.NoError(t, db.Create(&user).Error)
	}
	require.NoError(t, db.Create(&model.Model{ModelName: "actual-model", Status: 1, Description: "Metadata from database"}).Error)
	engine := gin.New()
	api := engine.Group("/api")
	RegisterLocalRoutes(api, api.Group("/subscription"))
	api.GET("/pricing", middleware.HeaderNavModuleAuth("pricing"), func(c *gin.Context) { c.Status(http.StatusOK) })

	for _, method := range []string{http.MethodGet, http.MethodPut} {
		for _, test := range []struct {
			name string
			role int
			want int
		}{
			{"anonymous", 0, http.StatusUnauthorized},
			{"user", common.RoleCommonUser, http.StatusForbidden},
			{"admin", common.RoleAdminUser, http.StatusForbidden},
		} {
			t.Run(method+" "+test.name, func(t *testing.T) {
				request := httptest.NewRequest(method, "/api/option/homepage_models", strings.NewReader(`{"enabled":true,"models":[]}`))
				if test.role > 0 {
					request.Header.Set("Authorization", "Bearer homepage-test-role-"+common.Interface2String(test.role))
				}
				response := httptest.NewRecorder()
				engine.ServeHTTP(response, request)
				assert.Equal(t, test.want, response.Code)
			})
		}
	}
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/homepage/models", nil))
	assert.Equal(t, http.StatusOK, response.Code)
	assert.JSONEq(t, `{"success":true,"message":"","data":{"enabled":false,"models":[]}}`, response.Body.String())
	pricing := httptest.NewRecorder()
	engine.ServeHTTP(pricing, httptest.NewRequest(http.MethodGet, "/api/pricing", nil))
	assert.Equal(t, http.StatusForbidden, pricing.Code)

	configRaw := `{"enabled":true,"models":[{"model_name":"actual-model","enabled":true,"order":0,"featured":true,"scenario":{"zh":"","en":""}}]}`
	request := httptest.NewRequest(http.MethodPut, "/api/option/homepage_models", strings.NewReader(configRaw))
	request.Header.Set("Authorization", "Bearer homepage-test-role-100")
	response = httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Success bool                     `json:"success"`
		Data    dto.HomepageModelsConfig `json:"data"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.True(t, payload.Success)
	assert.True(t, payload.Data.Enabled)
	require.Len(t, payload.Data.Models, 1)
	var saved model.Option
	require.NoError(t, db.Where("key = ?", model.HomepageModelsOptionKey).First(&saved).Error)
	assert.JSONEq(t, configRaw, saved.Value)
	request = httptest.NewRequest(http.MethodGet, "/api/option/homepage_models", nil)
	request.Header.Set("Authorization", "Bearer homepage-test-role-100")
	response = httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code)
	assert.JSONEq(t, `{"success":true,"message":"","data":`+configRaw+`}`, response.Body.String())
	response = httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/homepage/models", nil))
	require.Equal(t, http.StatusOK, response.Code)
	assert.JSONEq(t, `{"success":true,"message":"","data":{"enabled":true,"models":[{"model_name":"actual-model","description":"Metadata from database","featured":true,"scenario":{"zh":"","en":""}}]}}`, response.Body.String())
	var logs []model.AuditLog
	require.NoError(t, db.Where("category = ? AND action = ?", model.AuditCategoryOperation, "option.update").Find(&logs).Error)
	require.Len(t, logs, 1)
	assert.Equal(t, common.RoleRootUser, logs[0].ActorRole)
	assert.True(t, logs[0].Success)
	assert.Equal(t, http.MethodPut, logs[0].Method)
	assert.Equal(t, "/api/option/homepage_models", logs[0].Route)
	assert.Contains(t, logs[0].Content, "homepage_models")
	require.NotNil(t, logs[0].Other.Op)
	assert.Equal(t, "option.update", logs[0].Other.Op.Action)
	encodedAudit, err := common.Marshal(logs[0])
	require.NoError(t, err)
	assert.NotContains(t, string(encodedAudit), "actual-model")
	assert.NotContains(t, string(encodedAudit), "homepage-test-role-")

	common.OptionMapRWMutex.Lock()
	common.OptionMap[model.HomepageModelsOptionKey] = "invalid persisted configuration"
	common.OptionMapRWMutex.Unlock()
	for _, path := range []string{"/api/homepage/models", "/api/option/homepage_models"} {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request.Header.Set("Authorization", "Bearer homepage-test-role-100")
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, request)
		assert.Equal(t, http.StatusInternalServerError, response.Code)
		assert.Contains(t, response.Body.String(), `"success":false`)
		assert.NotContains(t, response.Body.String(), "invalid persisted configuration")
	}
}
