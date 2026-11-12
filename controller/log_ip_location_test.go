package controller

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestLogIPLocationAuthorizesLogOwnerBeforeReadingCache(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	previousDB, previousRedis := model.LOG_DB, common.RedisEnabled
	model.LOG_DB, common.RedisEnabled = db, false
	t.Cleanup(func() { model.LOG_DB, common.RedisEnabled = previousDB, previousRedis; _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	require.NoError(t, db.Create(&model.Log{Id: 72, UserId: 1, Ip: "8.8.8.8"}).Error)
	for _, tc := range []struct {
		name, ip, method     string
		userID, role, status int
	}{
		{"owner", "8.8.8.8", "GET", 1, common.RoleCommonUser, 200},
		{"another-user", "8.8.8.8", "GET", 2, common.RoleCommonUser, 404},
		{"admin", "8.8.8.8", "GET", 2, common.RoleAdminUser, 200},
		{"unrecorded-ip", "1.1.1.1", "GET", 1, common.RoleCommonUser, 404},
		{"invalid-ip", "https://localhost", "GET", 1, common.RoleCommonUser, 400},
		{"another-user-query", "8.8.8.8", "POST", 2, common.RoleCommonUser, 404},
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
