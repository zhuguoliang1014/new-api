package controller

import (
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetHomepageModels(c *gin.Context) {
	data, err := model.GetHomepageModels()
	if err != nil {
		common.SysError("failed to load homepage models: " + err.Error())
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Homepage models are unavailable"})
		return
	}
	common.ApiSuccess(c, data)
}

func GetHomepageModelsConfig(c *gin.Context) {
	config, err := model.GetHomepageModelsConfig()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Homepage models configuration is invalid"})
		return
	}
	common.ApiSuccess(c, config)
}

func UpdateHomepageModelsConfig(c *gin.Context) {
	// The bounded configuration contains only 24 short plain-text entries.
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64*1024)
	raw, err := io.ReadAll(c.Request.Body)
	if err != nil || strings.TrimSpace(string(raw)) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Invalid homepage models configuration"})
		return
	}
	config, err := model.ParseHomepageModelsConfig(string(raw))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	encoded, err := common.Marshal(config)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if err := model.ValidateHomepageModelsOption(string(encoded)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": err.Error()})
		return
	}
	if err := model.UpdateOptionsBulk(map[string]string{model.HomepageModelsOptionKey: string(encoded)}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "Failed to save homepage models configuration"})
		return
	}
	recordManageAudit(c, "option.update", map[string]any{"key": model.HomepageModelsOptionKey})
	common.ApiSuccess(c, config)
}
