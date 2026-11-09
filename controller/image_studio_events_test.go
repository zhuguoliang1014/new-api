package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStudioInteractionEventsAreBoundedAndPrivate(t *testing.T) {
	user, _ := setupAccessTokenAudit(t)
	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Set("username", user.Username)
		c.Set("role", common.RoleCommonUser)
	})
	router.POST("/events", RecordImageStudioEvent)
	body := `{"event_id":"event-studio-test-000001","action":"reference_selected","mode":"portrait","role":"pose","asset_id":"full_sexy_P001"}`
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/events", strings.NewReader(body))
		router.ServeHTTP(w, req)
		require.Equal(t, 204, w.Code)
	}
	var rows []model.AuditLog
	require.NoError(t, model.LOG_DB.Where("category = ?", "image_studio").Find(&rows).Error)
	require.Len(t, rows, 1)
	require.Equal(t, "studio.reference_selected", rows[0].Action)
	encoded, err := rows[0].Other.Value()
	require.NoError(t, err)
	require.NotContains(t, encoded, "prompt")
	require.Contains(t, encoded, "full_sexy_P001")
	for _, invalid := range []string{
		strings.Replace(body, `"mode":"portrait"`, `"mode":"secret-prompt"`, 1),
		strings.Replace(body, `"reference_selected"`, `"ready"`, 1),
		strings.Replace(body, `"role":"pose"`, `"role":"admin"`, 1),
		strings.Replace(body, `"full_sexy_P001"`, `"https://private/key"`, 1),
		strings.Replace(body, `"mode":"portrait"`, `"mode":"portrait","prompt":"must-not-log"`, 1),
		body + `{}`, strings.Repeat("x", 1025)} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("POST", "/events", strings.NewReader(invalid)))
		require.Equal(t, 400, w.Code)
	}
	require.NoError(t, model.LOG_DB.Where("category = ?", "image_studio").Find(&rows).Error)
	require.Len(t, rows, 1)
}
