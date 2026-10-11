package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExtractPlaygroundPromptSupportsStringAndContentBlocks(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    string
	}{
		{
			name:    "legacy string content",
			payload: `{"choices":[{"message":{"content":"A cinematic mountain lake at sunrise."}}]}`,
			want:    "A cinematic mountain lake at sunrise.",
		},
		{
			name:    "text content blocks",
			payload: `{"choices":[{"message":{"content":[{"type":"text","text":"A cinematic "},{"type":"output_text","text":"mountain lake at sunrise."},{"type":"image","image_url":"ignored"}]}}]}`,
			want:    "A cinematic mountain lake at sunrise.",
		},
		{
			name:    "streaming text content blocks",
			payload: "data: {\"choices\":[{\"delta\":{\"content\":[{\"type\":\"text\",\"text\":\"A cinematic \"}]}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"mountain lake at sunrise.\"}}]}\n\ndata: [DONE]\n",
			want:    "A cinematic mountain lake at sunrise.",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := extractPlaygroundPrompt([]byte(test.payload))
			require.NoError(t, err)
			assert.Equal(t, test.want, got)
		})
	}
}

func TestExtractPlaygroundPromptRejectsUnsupportedContent(t *testing.T) {
	_, err := extractPlaygroundPrompt([]byte(`{"choices":[{"message":{"content":[{"type":"refusal","refusal":"no"}]}}]}`))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty prompt response")
}

func TestPlaygroundAgentConfigurationDatabase(t *testing.T) {
	db, dialect := openTaskDialectDatabase(t, &model.User{}, &model.Token{})
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldRedis, oldMaster := common.RedisEnabled, common.IsMasterNode
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	model.DB, common.RedisEnabled, common.IsMasterNode = db, false, false
	common.SetDatabaseTypes(dialect, oldLog)
	t.Setenv("LOG_SQL_DSN", "")
	require.NoError(t, model.InitLogDB()) // Initialize the production dialect's reserved column quoting.
	oldRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1}`))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldRatios))
		model.DB = oldDB
		common.SetDatabaseTypes(oldMain, oldLog)
		require.NoError(t, model.InitLogDB())
		model.LOG_DB = oldLogDB
		common.RedisEnabled, common.IsMasterNode = oldRedis, oldMaster
		common.SetDatabaseTypes(oldMain, oldLog)
	})
	user := model.User{Username: "studio-owner", AffCode: "studio-owner", Status: common.UserStatusEnabled, Group: "default"}
	user.SetSetting(dto.UserSetting{Language: "zh", SidebarModules: "existing-sidebar"})
	require.NoError(t, db.Create(&user).Error)
	promptToken := model.Token{UserId: user.Id, Key: "studio-prompt-test-secret", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true, ModelLimitsEnabled: true, ModelLimits: "gpt-6.1-sol"}
	imageToken := model.Token{UserId: user.Id, Key: "studio-image-test-secret", Status: common.TokenStatusEnabled, ExpiredTime: -1, UnlimitedQuota: true, ModelLimitsEnabled: true, ModelLimits: "gpt-image-2"}
	require.NoError(t, db.Create(&promptToken).Error)
	require.NoError(t, db.Create(&imageToken).Error)
	config := dto.ImagePlaygroundSetting{
		Prompt: &dto.ImagePlaygroundAgent{TokenId: promptToken.Id, Model: "gpt-6.1-sol"},
		Image:  &dto.ImagePlaygroundAgent{TokenId: imageToken.Id, Model: "gpt-image-2"},
	}
	savedSetting := user.GetSetting()
	savedSetting.ImagePlayground = &config
	require.NoError(t, model.UpdateUserSetting(user.Id, savedSetting))

	router := gin.New()
	router.Use(middleware.BodyStorageCleanup(), func(c *gin.Context) {
		// The dashboard authentication boundary is covered by middleware tests.
		c.Set("id", user.Id)
		c.Set("use_access_token", c.GetHeader("X-Test-Access-Token") == "true")
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
	})
	router.GET("/settings", GetPlaygroundAgentConfig)
	router.PUT("/settings", UpdatePlaygroundAgentConfig)
	for path, profile := range map[string]middleware.PlaygroundAgentProfile{
		"/prompt": middleware.PlaygroundAgentPrompt,
		"/image":  middleware.PlaygroundAgentImage,
	} {
		router.POST(path, middleware.PlaygroundAgent(profile), func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"model":    common.GetContextKeyString(c, constant.ContextKeyPlaygroundModel),
				"token_id": c.GetInt("token_id"),
				"group":    common.GetContextKeyString(c, constant.ContextKeyUsingGroup),
			})
		})
	}
	request := func(method, path string, body any, accessToken bool) *httptest.ResponseRecorder {
		payload, err := common.Marshal(body)
		require.NoError(t, err)
		req := httptest.NewRequest(method, path, strings.NewReader(string(payload)))
		req.Header.Set("Content-Type", "application/json")
		req.RemoteAddr = "192.0.2.10:1234"
		if accessToken {
			req.Header.Set("X-Test-Access-Token", "true")
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}

	t.Run("saving and reloading both slots preserves existing settings without exposing secrets", func(t *testing.T) {
		require.NoError(t, model.UpdateUserSetting(user.Id, user.GetSetting()))
		t.Cleanup(func() { require.NoError(t, model.UpdateUserSetting(user.Id, savedSetting)) })
		empty := request(http.MethodGet, "/settings", nil, false)
		require.Equal(t, http.StatusOK, empty.Code)
		assert.JSONEq(t, `{"success":true,"data":{}}`, empty.Body.String())
		require.Equal(t, http.StatusBadRequest, request(http.MethodPost, "/image", nil, false).Code)
		saved := request(http.MethodPut, "/settings", config, false)
		require.Equal(t, http.StatusOK, saved.Code, saved.Body.String())
		setting, err := model.GetUserSetting(user.Id, true)
		require.NoError(t, err)
		assert.Equal(t, "zh", setting.Language)
		assert.Equal(t, "existing-sidebar", setting.SidebarModules)
		assert.Equal(t, &config, setting.ImagePlayground)
		loaded := request(http.MethodGet, "/settings", nil, false)
		require.Equal(t, http.StatusOK, loaded.Code)
		assert.JSONEq(t, saved.Body.String(), loaded.Body.String())
		assert.NotContains(t, loaded.Body.String(), promptToken.Key)
		assert.NotContains(t, loaded.Body.String(), imageToken.Key)
		var persisted model.User
		require.NoError(t, db.First(&persisted, user.Id).Error)
		assert.NotContains(t, persisted.Setting, promptToken.Key)
		assert.NotContains(t, persisted.Setting, imageToken.Key)
	})

	t.Run("each slot resolves its owned token and stored model instead of client input", func(t *testing.T) {
		for path, agent := range map[string]*dto.ImagePlaygroundAgent{"/prompt": config.Prompt, "/image": config.Image} {
			response := request(http.MethodPost, path, gin.H{"model": "unapproved-model"}, false)
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
			var routed struct {
				Model   string `json:"model"`
				TokenID int    `json:"token_id"`
				Group   string `json:"group"`
			}
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &routed))
			assert.Equal(t, agent.Model, routed.Model)
			assert.Equal(t, agent.TokenId, routed.TokenID)
			assert.Equal(t, "default", routed.Group)
		}
		assert.Equal(t, http.StatusForbidden, request(http.MethodPost, "/image", nil, true).Code)
	})

	for _, tc := range []struct {
		name   string
		values map[string]any
	}{
		{"another user's token", map[string]any{"user_id": user.Id + 1}},
		{"disabled token", map[string]any{"status": common.TokenStatusDisabled}},
		{"expired token", map[string]any{"expired_time": common.GetTimestamp() - 10}},
		{"exhausted token", map[string]any{"unlimited_quota": false, "remain_quota": 0}},
		{"removed model permission", map[string]any{"model_limits": "other-model"}},
	} {
		t.Run(tc.name+" cannot be saved or used after selection", func(t *testing.T) {
			t.Cleanup(func() {
				require.NoError(t, db.Model(&model.Token{}).Where("id = ?", imageToken.Id).Updates(map[string]any{
					"user_id": user.Id, "status": common.TokenStatusEnabled, "expired_time": -1,
					"unlimited_quota": true, "remain_quota": 0, "model_limits": "gpt-image-2",
				}).Error)
			})
			require.NoError(t, db.Model(&model.Token{}).Where("id = ?", imageToken.Id).Updates(tc.values).Error)
			saved := request(http.MethodPut, "/settings", config, false)
			assert.Equal(t, http.StatusBadRequest, saved.Code)
			routed := request(http.MethodPost, "/image", nil, false)
			assert.Contains(t, []int{http.StatusBadRequest, http.StatusForbidden}, routed.Code)
			setting, err := model.GetUserSetting(user.Id, true)
			require.NoError(t, err)
			assert.Equal(t, &config, setting.ImagePlayground, "failed updates must preserve the saved configuration")
		})
	}

	t.Run("token IP restrictions are enforced for each studio request", func(t *testing.T) {
		t.Cleanup(func() {
			require.NoError(t, db.Model(&model.Token{}).Where("id = ?", imageToken.Id).Update("allow_ips", "").Error)
		})
		require.NoError(t, db.Model(&model.Token{}).Where("id = ?", imageToken.Id).Update("allow_ips", "198.51.100.0/24").Error)
		assert.Equal(t, http.StatusForbidden, request(http.MethodPost, "/image", nil, false).Code)
		require.NoError(t, db.Model(&model.Token{}).Where("id = ?", imageToken.Id).Update("allow_ips", "192.0.2.0/24").Error)
		assert.Equal(t, http.StatusOK, request(http.MethodPost, "/image", nil, false).Code)
	})

	t.Run("removed group permission prevents using an already selected token", func(t *testing.T) {
		t.Cleanup(func() {
			require.NoError(t, db.Model(&model.Token{}).Where("id = ?", imageToken.Id).Update("group", "").Error)
		})
		require.NoError(t, db.Model(&model.Token{}).Where("id = ?", imageToken.Id).Update("group", "removed-group").Error)
		assert.Equal(t, http.StatusForbidden, request(http.MethodPost, "/image", nil, false).Code)
	})
}
