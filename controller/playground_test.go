package controller

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
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

	t.Run("prompt-only updates preserve the existing image slot", func(t *testing.T) {
		response := request(http.MethodPut, "/settings", dto.ImagePlaygroundSetting{Prompt: config.Prompt}, false)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		setting, err := model.GetUserSetting(user.Id, true)
		require.NoError(t, err)
		assert.Equal(t, config.Image, setting.ImagePlayground.Image)
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

func TestImageStudioBootstrapAndRoutingDatabase(t *testing.T) {
	db, dialect := openTaskDialectDatabase(t, &model.User{}, &model.Token{}, &model.Ability{}, &model.AuditLog{})
	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldRedis, oldMemory := common.RedisEnabled, common.MemoryCacheEnabled
	oldMain, oldLog := common.MainDatabaseType(), common.LogDatabaseType()
	oldRatios, oldUsable := ratio_setting.GroupRatio2JSONString(), setting.UserUsableGroups2JSONString()
	model.DB, model.LOG_DB = db, db
	common.RedisEnabled, common.MemoryCacheEnabled = false, false
	common.SetDatabaseTypes(dialect, dialect)
	// InitLogDB configures reserved identifier quoting for this actual dialect.
	t.Setenv("LOG_SQL_DSN", "")
	require.NoError(t, model.InitLogDB())
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(oldRatios))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(oldUsable))
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.SetDatabaseTypes(oldMain, oldLog)
		require.NoError(t, model.InitLogDB())
		model.LOG_DB = oldLogDB
		common.RedisEnabled, common.MemoryCacheEnabled = oldRedis, oldMemory
	})
	ratios, usable := map[string]float64{"default": 1}, map[string]string{}
	for _, profile := range service.ImageStudioProfiles {
		ratios[profile.Group] = 1
		usable[profile.Group] = profile.Name
		for _, name := range []string{"gpt-image-2", "gpt-image-2.5"} {
			require.NoError(t, db.Create(&model.Ability{Group: profile.Group, Model: name, ChannelId: 1, Enabled: true}).Error)
		}
	}
	encoded, err := common.Marshal(ratios)
	require.NoError(t, err)
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(string(encoded)))
	encoded, err = common.Marshal(usable)
	require.NoError(t, err)
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(string(encoded)))
	user := model.User{Username: "bootstrap-artist", AffCode: "bootstrap-artist", Status: common.UserStatusEnabled, Group: "default", Quota: 1000}
	require.NoError(t, db.Create(&user).Error)
	router := gin.New()
	router.Use(middleware.BodyStorageCleanup(), func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Set("role", common.RoleCommonUser)
		c.Set("username", user.Username)
		c.Set("use_access_token", c.GetHeader("X-Test-PAT") == "true")
		common.SetContextKey(c, constant.ContextKeyUserGroup, "default")
	})
	router.POST("/bootstrap", BootstrapImageStudio)
	router.POST("/image", middleware.PlaygroundAgent(middleware.PlaygroundAgentImage), func(c *gin.Context) {
		c.JSON(200, gin.H{"model": common.GetContextKeyString(c, constant.ContextKeyPlaygroundModel), "group": common.GetContextKeyString(c, constant.ContextKeyUsingGroup), "token_id": c.GetInt("token_id")})
	})
	request := func(path, group, modelName, body string, pat bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Studio-Group", url.QueryEscape(group))
		req.Header.Set("X-Studio-Model", modelName)
		if pat {
			req.Header.Set("X-Test-PAT", "true")
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	t.Run("concurrent first opens create only one key for each group", func(t *testing.T) {
		results := make(chan *httptest.ResponseRecorder, 6)
		var workers sync.WaitGroup
		for range 6 {
			workers.Go(func() { results <- request("/bootstrap", "", "", "{}", false) })
		}
		workers.Wait()
		close(results)
		for response := range results {
			require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		}
		var count int64
		require.NoError(t, db.Model(&model.Token{}).Where("user_id = ?", user.Id).Count(&count).Error)
		assert.EqualValues(t, 3, count)
	})
	t.Run("creates three restricted keys once without leaking secrets or changing balances", func(t *testing.T) {
		for range 2 {
			response := request("/bootstrap", "", "", "{}", false)
			require.Equal(t, 200, response.Code, response.Body.String())
			assert.NotContains(t, response.Body.String(), "token_id")
		}
		var tokens []model.Token
		require.NoError(t, db.Where("user_id = ?", user.Id).Find(&tokens).Error)
		require.Len(t, tokens, 3)
		response := request("/bootstrap", "", "", "{}", false)
		for _, token := range tokens {
			assert.NotContains(t, response.Body.String(), token.Key)
			assert.True(t, token.ModelLimitsEnabled)
			assert.True(t, token.UnlimitedQuota)
			assert.Equal(t, "gpt-image-2,gpt-image-2.5", token.ModelLimits)
		}
		var current model.User
		require.NoError(t, db.First(&current, user.Id).Error)
		assert.Equal(t, user.Quota, current.Quota)
		assert.Equal(t, user.Setting, current.Setting)
	})
	basic, high, native := service.ImageStudioProfiles[0].Group, service.ImageStudioProfiles[1].Group, service.ImageStudioProfiles[2].Group
	t.Run("group and model are resolved per request without changing saved agent settings", func(t *testing.T) {
		for _, group := range []string{basic, high, native} {
			response := request("/image", group, "gpt-image-2.5", `{"model":"unapproved","n":2,"size":"1024x1024"}`, false)
			require.Equal(t, 200, response.Code, response.Body.String())
			assert.Contains(t, response.Body.String(), `"model":"gpt-image-2.5"`)
			assert.Contains(t, response.Body.String(), group)
		}
		assert.Equal(t, 400, request("/image", basic, "missing-model", `{}`, false).Code)
		assert.Equal(t, 403, request("/image", "default", "gpt-image-2", `{}`, false).Code)
		assert.Equal(t, 403, request("/image", basic, "gpt-image-2", `{}`, true).Code)
		assert.Equal(t, 403, request("/bootstrap", "", "", `{}`, true).Code)
	})
	t.Run("enforces native and upscale resolution plus request bounds", func(t *testing.T) {
		for _, tc := range []struct {
			group, body string
			status      int
		}{
			{high, `{"size":"10240x10240","n":4,"quality":"high"}`, 200},
			{basic, `{"size":"10240x10240"}`, 400},
			{native, `{"size":"4096x4096"}`, 400},
			{native, `{"size":"3840x3840"}`, 400},
			{native, `{"size":"3840x2160"}`, 200},
			{high, `{"size":"10241x10240"}`, 400},
			{high, `{"size":"999999999999999999999x1024"}`, 400},
			{high, `{"n":18446744073709551615}`, 400},
			{high, `{"n":0}`, 400},
			{high, `{"n":-1}`, 400},
			{high, `{"parameters":{"size":"20000x20000"}}`, 400},
			{high, `{"output_format":"jpeg","background":"transparent"}`, 400},
		} {
			response := request("/image", tc.group, "gpt-image-2", tc.body, false)
			assert.Equal(t, tc.status, response.Code, tc.body+response.Body.String())
		}
	})
	t.Run("multipart edits enforce the same resolution and count bounds", func(t *testing.T) {
		for _, tc := range []struct {
			size, n string
			status  int
		}{{"10240x5760", "2", 200}, {"10256x5760", "2", 400}, {"1024x1024", "-1", 400}} {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			require.NoError(t, writer.WriteField("size", tc.size))
			require.NoError(t, writer.WriteField("n", tc.n))
			require.NoError(t, writer.Close())
			req := httptest.NewRequest(http.MethodPost, "/image", &body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			req.Header.Set("X-Studio-Group", url.QueryEscape(high))
			req.Header.Set("X-Studio-Model", "gpt-image-2")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			assert.Equal(t, tc.status, rec.Code, rec.Body.String())
		}
	})
	t.Run("disabled and deleted keys stay revoked when reopening the studio", func(t *testing.T) {
		token, err := model.GetImageStudioToken(user.Id, basic)
		require.NoError(t, err)
		require.NoError(t, db.Model(token).Update("status", common.TokenStatusDisabled).Error)
		require.Equal(t, 200, request("/bootstrap", "", "", "{}", false).Code)
		assert.Equal(t, 403, request("/image", basic, "gpt-image-2", `{}`, false).Code)
		require.NoError(t, db.Delete(token).Error)
		require.Equal(t, 200, request("/bootstrap", "", "", "{}", false).Code)
		assert.Equal(t, 403, request("/image", basic, "gpt-image-2", `{}`, false).Code)
		var count int64
		require.NoError(t, db.Unscoped().Model(&model.Token{}).Where("user_id = ?", user.Id).Count(&count).Error)
		assert.EqualValues(t, 3, count)
	})
	t.Run("removed group permission blocks routing and hides the group", func(t *testing.T) {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{}`))
		response := request("/bootstrap", "", "", "{}", false)
		assert.Equal(t, 200, response.Code)
		assert.JSONEq(t, `{"success":true,"data":[]}`, response.Body.String())
		assert.Equal(t, 403, request("/image", high, "gpt-image-2", `{}`, false).Code)
	})
}
