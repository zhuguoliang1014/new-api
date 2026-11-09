package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetSelfGiftQuota(c *gin.Context) {
	page := common.GetPageQuery(c)
	gifts, total, err := model.ListGiftQuota(c.GetInt("id"), page.GetStartIdx(), page.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetTotal(int(total))
	page.SetItems(gifts)
	common.ApiSuccess(c, page)
}
