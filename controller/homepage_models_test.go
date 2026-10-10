package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestHomepageModelsUpdateRejectsMalformedBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, body := range []string{"", "null", "[]", `{"enabled":true}{"enabled":false}`, `{"models":[{"model_name":"a","order":1.5}]}`, strings.Repeat(" ", 64*1024+1)} {
		t.Run(body[:min(len(body), 40)], func(t *testing.T) {
			response := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(response)
			context.Request = httptest.NewRequest(http.MethodPut, "/api/option/homepage_models", strings.NewReader(body))
			UpdateHomepageModelsConfig(context)
			assert.Equal(t, http.StatusBadRequest, response.Code)
			var payload map[string]any
			require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
			assert.Equal(t, false, payload["success"])
		})
	}
}

func TestHomepageModelsUpdateDatabaseFailureIsNotSuccess(t *testing.T) {
	previousDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() {
		model.DB = previousDB
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
	})
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/option/homepage_models", strings.NewReader(`{"enabled":true,"models":[]}`))
	UpdateHomepageModelsConfig(context)
	assert.Equal(t, http.StatusInternalServerError, response.Code)
	var payload map[string]any
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.Equal(t, false, payload["success"])
}

func TestHomepageModelsGenericOptionCannotBypassValidation(t *testing.T) {
	response := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(response)
	context.Request = httptest.NewRequest(http.MethodPut, "/api/option/", strings.NewReader(`{"key":"homepage_models","value":"{\"models\":[{\"model_name\":\"\"}]}"}`))
	UpdateOption(context)
	var payload map[string]any
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	assert.Equal(t, false, payload["success"])
}
