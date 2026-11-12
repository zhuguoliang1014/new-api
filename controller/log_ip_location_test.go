package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestLogIPLocationAuthorizesLogOwnerBeforeReadingCache(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, model.LOG_DB.AutoMigrate(&model.Log{}))
	user := model.User{Username: "ip-location-owner", AffCode: "ip-location-owner", Role: common.RoleCommonUser, Setting: `{"record_ip_log":true}`}
	require.NoError(t, db.Create(&user).Error)
	hidden := model.User{Username: "ip-location-hidden", AffCode: "ip-location-hidden", Role: common.RoleCommonUser, Setting: `{}`}
	require.NoError(t, db.Create(&hidden).Error)
	require.NoError(t, model.LOG_DB.Create(&model.Log{Id: 72, UserId: user.Id, Ip: "8.8.8.8"}).Error)
	require.NoError(t, model.LOG_DB.Create(&model.Log{Id: 73, UserId: hidden.Id, Ip: "1.1.1.1"}).Error)
	for _, tc := range []struct {
		name, ip, method     string
		userID, role, status int
	}{
		{"owner", "8.8.8.8", "GET", user.Id, common.RoleCommonUser, 200},
		{"another-user", "8.8.8.8", "GET", hidden.Id, common.RoleCommonUser, 404},
		{"admin", "8.8.8.8", "GET", hidden.Id, common.RoleAdminUser, 200},
		{"unrecorded-ip", "1.1.1.1", "GET", user.Id, common.RoleCommonUser, 404},
		{"invalid-ip", "https://localhost", "GET", user.Id, common.RoleCommonUser, 400},
		{"another-user-query", "8.8.8.8", "POST", hidden.Id, common.RoleCommonUser, 404},
		{"privacy-disabled-read", "1.1.1.1", "GET", hidden.Id, common.RoleCommonUser, 404},
		{"privacy-disabled-query", "1.1.1.1", "POST", hidden.Id, common.RoleCommonUser, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(tc.method, "/api/log/ip-location?ip="+url.QueryEscape(tc.ip), nil)
			c.Set("id", tc.userID)
			c.Set("role", tc.role)
			GetLogIPLocation(c)
			require.Equal(t, tc.status, w.Code)
			if tc.status == http.StatusOK {
				require.Contains(t, w.Body.String(), `"location":null`)
				require.Contains(t, w.Body.String(), `"query_available":false`)
				require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			}
		})
	}
}
