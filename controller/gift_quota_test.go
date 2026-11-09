package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGiftQuotaController(t *testing.T) {
	db := setupManageUserTestDB(t)
	require.NoError(t, db.AutoMigrate(&model.GiftQuota{}, &model.WalletGiftAllocation{}))
	operator := createQuotaTestOperator(t, db, common.RoleRootUser)
	user := model.User{Username: "gift-wallet-user", AffCode: "gift-a", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, Quota: 1000}
	other := model.User{Username: "other-gift-wallet-user", AffCode: "gift-b", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, AuthVersion: 1, Quota: 1000}
	require.NoError(t, db.Create(&user).Error)
	require.NoError(t, db.Create(&other).Error)
	response := performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":"add","value":500,"quota_type":"gift"}`, user.Id))
	require.Contains(t, response.Body.String(), `"success":true`)
	balance, err := model.GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, 1000, balance.BalanceQuota)
	require.Equal(t, 500, balance.GiftQuota)
	var audit model.AuditLog
	require.NoError(t, model.LOG_DB.Where("user_id = ?", operator.Id).First(&audit).Error)
	encoded, err := common.Marshal(audit.Other.Op.Params)
	require.NoError(t, err)
	require.Contains(t, string(encoded), `"quota_type":"gift"`)
	_, err = model.GrantGiftQuota(other.Id, 300, "admin", "other-private-gift")
	require.NoError(t, err)
	request := func(handler gin.HandlerFunc, path string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodGet, path, nil)
		ctx.Set("id", user.Id)
		ctx.Set("role", user.Role)
		handler(ctx)
		return recorder
	}
	response = request(GetSelf, "/api/user/self")
	require.Contains(t, response.Body.String(), `"balance_quota":1000`)
	require.Contains(t, response.Body.String(), `"gift_quota":500`)
	require.NotContains(t, response.Body.String(), "gift_wallet_enabled")
	require.NoError(t, db.Model(&model.GiftQuota{}).Where("user_id = ?", user.Id).Update("expires_at", time.Now().Unix()).Error)
	response = request(GetSelfGiftQuota, fmt.Sprintf("/api/user/self/gifts?user_id=%d", other.Id))
	require.Contains(t, response.Body.String(), `"expired":500`)
	require.Contains(t, response.Body.String(), `"remaining":0`)
	require.Contains(t, response.Body.String(), `"total":1`)
	require.NotContains(t, response.Body.String(), "other-private-gift")
	require.NotContains(t, response.Body.String(), "reference")
	require.NotContains(t, response.Body.String(), `"granted":300`)
	balance, err = model.GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, 1000, balance.Quota)
	response = performManageUserRequest(t, fmt.Sprintf(`{"id":%d,"action":"add_quota","mode":"add","value":200,"quota_type":"balance"}`, user.Id))
	require.Contains(t, response.Body.String(), `"success":true`)
	balance, err = model.GetWalletBalance(user.Id)
	require.NoError(t, err)
	require.Equal(t, 1200, balance.BalanceQuota)
	require.Zero(t, balance.GiftQuota)
}
