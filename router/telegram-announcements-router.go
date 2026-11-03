package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

func registerTelegramAnnouncementRoutes(api *gin.RouterGroup) {
	group := api.Group("/telegram-announcements", middleware.RootAuth(), middleware.DisableCache())
	group.GET("/", controller.ListTelegramAnnouncements)
	group.GET("/config", controller.GetTelegramAnnouncementConfig)
	group.PUT("/template", controller.UpdateTelegramAnnouncementTemplate)
	group.POST("/preview", controller.PreviewTelegramAnnouncement)
	group.POST("/publish", middleware.CriticalRateLimit(), controller.PublishTelegramAnnouncement)
}
