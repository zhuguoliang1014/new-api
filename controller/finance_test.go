package controller

import (
	"bytes"
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestFinanceHTTPPermissionsAndExports(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	oldDB, oldMaster := model.DB, common.IsMasterNode
	model.DB, common.IsMasterNode = db, true
	t.Cleanup(func() { model.DB, common.IsMasterNode = oldDB, oldMaster; assert.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.AutoMigrate(&model.FinanceEntry{}, &model.FinanceAudit{}, &model.FinanceAttachment{}, &model.FinanceCategory{}, &model.FinanceState{}, &model.FinancePeriod{}, &model.FinanceRule{}, &model.CasbinRule{}, &model.AuthzRole{}))
	require.NoError(t, authz.Init(db))
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		role := common.RoleAdminUser
		if c.GetHeader("X-Test-Role") == "root" {
			role = common.RoleRootUser
		}
		c.Set("id", 42)
		c.Set("role", role)
	})
	engine.GET("/export", middleware.RequirePermission(authz.FinanceRead), middleware.RequirePermission(authz.FinanceExport), ExportFinanceCSV)
	engine.GET("/attachments/:id", middleware.RequirePermission(authz.FinanceRead), DownloadFinanceAttachment)
	engine.POST("/entries", middleware.RequirePermission(authz.FinanceRead), middleware.RequirePermission(authz.FinanceWrite), SaveFinanceEntry)
	fee := int64(6)
	for _, entry := range []model.FinanceEntry{
		{EntryKey: "receipt", Kind: "income", Month: "2026-11", Date: "2026-11-01", AmountCents: 1000, FeeCents: &fee, Currency: "CNY", Source: "payment", SourceRef: "order", Note: "=HYPERLINK(\"https://example.invalid\")"},
		{EntryKey: "expense", Kind: "expense", Month: "2026-11", Date: "2026-11-01", AmountCents: 995, Currency: "CNY", Source: "manual", Counterparty: "supplier", Note: "comma, quote \" and\nnewline"},
		{EntryKey: "void", Kind: "expense", Month: "2026-11", AmountCents: 500, Currency: "CNY", Voided: true},
	} {
		require.NoError(t, db.Create(&entry).Error)
	}
	request := func(method, path, body, role string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, path, strings.NewReader(body))
		r.Header.Set("X-Test-Role", role)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, r)
		return w
	}
	assert.Equal(t, http.StatusForbidden, request("GET", "/export?from=2026-11&to=2026-11", "", "admin").Code)
	require.NoError(t, authz.SetUserPermissions(42, authz.PermissionsMap{authz.ResourceFinance: {authz.ActionRead: true}}))
	assert.Equal(t, http.StatusForbidden, request("POST", "/entries", `{}`, "admin").Code)
	assert.Equal(t, http.StatusForbidden, request("GET", "/export", "", "admin").Code)
	response := request("GET", "/export?from=2026-11&to=2026-11", "", "root")
	require.Equal(t, http.StatusOK, response.Code)
	rows, err := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(response.Body.Bytes(), []byte("\uFEFF")))).ReadAll()
	require.NoError(t, err)
	require.Len(t, rows, 3)
	assert.Contains(t, response.Body.String(), "'=HYPERLINK")
	assert.Contains(t, response.Body.String(), "comma, quote")
	response = request("GET", "/export?from=2026-11&to=2026-11&view=summary", "", "root")
	require.Equal(t, 200, response.Code)
	rows, err = csv.NewReader(strings.NewReader(strings.TrimPrefix(response.Body.String(), "\uFEFF"))).ReadAll()
	require.NoError(t, err)
	assert.Equal(t, "9.94", rows[1][1])
	assert.Equal(t, "-0.01", rows[1][7])
	assert.Equal(t, http.StatusBadRequest, request("GET", "/export?from=2026-99&to=2026-11", "", "root").Code)
	assert.Equal(t, http.StatusBadRequest, request("POST", "/entries", `{broken`, "root").Code)
	require.NoError(t, db.Create(&model.FinanceAttachment{EntryID: 1, Name: "private.pdf", MIME: "application/pdf", Content: []byte("%PDF-finance-test")}).Error)
	assert.Equal(t, 200, request("GET", "/attachments/1", "", "admin").Code)
	require.NoError(t, authz.SetUserPermissions(42, authz.PermissionsMap{authz.ResourceFinance: {authz.ActionRead: false}}))
	assert.Equal(t, 403, request("GET", "/attachments/1", "", "admin").Code)
	assert.Equal(t, 400, request("GET", "/attachments/-1", "", "root").Code)
}
