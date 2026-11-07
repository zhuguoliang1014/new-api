package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service/authz"
	"github.com/gin-gonic/gin"
)

func setFinanceRouter(api *gin.RouterGroup) {
	group := api.Group("/finance", middleware.AdminAuth(), middleware.DisableCache())
	for _, route := range []struct {
		method, path string
		permission   authz.Permission
		handler      gin.HandlerFunc
	}{
		{"GET", "/report", authz.FinanceRead, controller.GetFinanceReport},
		{"GET", "/entries", authz.FinanceRead, controller.ListFinanceEntries},
		{"GET", "/entries/:id", authz.FinanceRead, controller.GetFinanceEntryDetails},
		{"GET", "/attachments/:id", authz.FinanceRead, controller.DownloadFinanceAttachment},
		{"GET", "/export", authz.FinanceExport, controller.ExportFinanceCSV},
		{"POST", "/sync", authz.FinanceRead, controller.SyncFinanceIncome},
		{"POST", "/entries", authz.FinanceWrite, controller.SaveFinanceEntry},
		{"PUT", "/entries/:id", authz.FinanceWrite, controller.SaveFinanceEntry},
		{"POST", "/entries/:id/void", authz.FinanceWrite, controller.VoidFinanceEntry},
		{"POST", "/entries/:id/reconcile", authz.FinanceWrite, controller.ReconcileFinanceEntry},
		{"POST", "/entries/:id/attachments", authz.FinanceWrite, controller.UploadFinanceAttachment},
		{"POST", "/rules", authz.FinanceManage, controller.AddFinanceRule},
		{"POST", "/categories", authz.FinanceManage, controller.SaveFinanceCategory},
		{"PUT", "/categories/:id", authz.FinanceManage, controller.SaveFinanceCategory},
		{"POST", "/period", authz.FinanceManage, controller.SetFinancePeriod},
		{"POST", "/import/preview", authz.FinanceManage, controller.PreviewFinanceImport},
		{"POST", "/import/commit", authz.FinanceManage, controller.CommitFinanceImport},
	} {
		middleware.DeclareAccessTokenPermissionRoute(route.method, "/api/finance"+route.path, route.permission)
		group.Handle(route.method, route.path, middleware.RequirePermission(authz.FinanceRead), middleware.RequirePermission(route.permission), route.handler)
	}
}
