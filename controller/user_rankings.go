package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"net/http"
	"time"
)

func GetDailyUserRankings(c *gin.Context) {
	day, err := service.UserRankingDay(c.Query("date"), time.Now())
	if err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, err)
		return
	}
	result, err := service.GetDailyUserRankings(c.Request.Context(), day, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	c.Header("Cache-Control", "private, no-store")
	c.JSON(http.StatusOK, gin.H{"success": true, "data": result})
}
