package router

// Local routes — kept out of api-router.go so upstream merges only touch the
// minimal hook call sites, not the route bodies themselves.

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/gin-gonic/gin"
)

// RegisterLocalSelfRoutes registers user-scoped local routes. Call from inside
// the selfRoute block of SetApiRouter, where selfRoute is in scope.
func RegisterLocalSelfRoutes(selfRoute *gin.RouterGroup) {
	selfRoute.POST("/hupijiao/amount", controller.RequestHupijiaoAmount)
	selfRoute.POST("/hupijiao/pay", middleware.CriticalRateLimit(), controller.RequestHupijiaoPay)
}

// RegisterLocalRoutes registers all remaining local routes (webhooks,
// subscription-scoped, Lucky Bag, and World Cup groups). Call once from SetApiRouter
// after the subscription route group is defined.
func RegisterLocalRoutes(
	apiRouter *gin.RouterGroup,
	subscriptionRoute *gin.RouterGroup,
) {
	// Hupijiao webhooks (no auth — verified by signature in handler)
	apiRouter.POST("/hupijiao/webhook", controller.HupijiaoWebhook)
	apiRouter.POST("/hupijiao/subscription/webhook", controller.HupijiaoSubscriptionWebhook)

	// Hupijiao subscription pay
	subscriptionRoute.POST("/hupijiao/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestHupijiao)

	// Lucky Bag — registers its own route groups under apiRouter
	registerLuckyBagRoutes(apiRouter)
	registerWorldCupRoutes(apiRouter)
}

func registerLuckyBagRoutes(apiRouter *gin.RouterGroup) {
	luckyBagRoute := apiRouter.Group("/lucky-bag")
	luckyBagRoute.Use(middleware.UserAuth())
	{
		luckyBagRoute.GET("/status", controller.LuckyBagStatus)
		luckyBagRoute.POST("/open", middleware.CriticalRateLimit(), controller.OpenLuckyBag)
		luckyBagRoute.GET("/history", controller.LuckyBagHistory)
	}
}

func registerWorldCupRoutes(apiRouter *gin.RouterGroup) {
	worldCupRoute := apiRouter.Group("/world-cup")
	worldCupRoute.Use(middleware.UserAuth())
	{
		worldCupRoute.GET("/status", controller.WorldCupStatus)
		worldCupRoute.POST("/predict", middleware.CriticalRateLimit(), controller.PredictWorldCup)
		worldCupRoute.GET("/history", controller.WorldCupPredictionHistory)
	}

	worldCupAdminRoute := apiRouter.Group("/world-cup/admin")
	worldCupAdminRoute.Use(middleware.AdminAuth())
	{
		worldCupAdminRoute.POST("/settle", middleware.CriticalRateLimit(), controller.AdminSettleWorldCupPredictions)
	}
}
