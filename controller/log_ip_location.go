package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// Log IDs in user-facing lists are display indices, so authorize by the
// recorded IP and log owner rather than accepting those IDs as database IDs.
func GetLogIPLocation(c *gin.Context) {
	ip, err := service.NormalizeLocationIP(c.Query("ip"))
	if err != nil {
		common.ApiErrorStatus(c, http.StatusBadRequest, err)
		return
	}
	var log model.Log
	tx := model.LOG_DB.WithContext(c.Request.Context()).Select("ip").Where("ip = ?", c.Query("ip"))
	if c.GetInt("role") < common.RoleAdminUser {
		tx = tx.Where("user_id = ?", c.GetInt("id"))
	}
	if err := tx.Take(&log).Error; err != nil {
		common.ApiErrorStatus(c, http.StatusNotFound, common.NewMessage("Log not found"))
		return
	}
	c.Header("Cache-Control", "no-store")
	available := service.CanQueryIPLocation(ip) && service.IPLocationCacheAvailable()
	if c.Request.Method == http.MethodPost {
		location, err := service.QueryIPLocation(c.Request.Context(), ip)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		common.ApiSuccess(c, gin.H{"location": location, "query_available": available})
		return
	}
	location, err := service.GetCachedIPLocation(c.Request.Context(), ip)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{"location": location, "query_available": available})
}
