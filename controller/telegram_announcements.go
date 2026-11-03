package controller

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func announcementError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	message := "Unable to process the announcement."
	switch {
	case errors.Is(err, service.ErrAnnouncementInvalid):
		status, message = http.StatusBadRequest, err.Error()
	case errors.Is(err, service.ErrAnnouncementChanged), errors.Is(err, service.ErrAnnouncementConflict):
		status, message = http.StatusConflict, err.Error()
	case errors.Is(err, service.ErrAnnouncementUnavailable), errors.Is(err, service.ErrAnnouncementChannelMissing), errors.Is(err, service.ErrAnnouncementChannelUnavailable):
		status, message = http.StatusServiceUnavailable, err.Error()
	}
	// Never propagate filesystem, transport URLs, credentials, or DB diagnostics.
	common.ApiErrorStatus(c, status, common.NewMessage(message))
}

func GetTelegramAnnouncementConfig(c *gin.Context) {
	template, err := service.GetAnnouncementTemplate()
	if err != nil {
		announcementError(c, err)
		return
	}
	ready, username, channelConfigured := service.AnnouncementBotStatus()
	common.ApiSuccess(c, gin.H{"template": template, "connected": ready, "bot_username": username, "channel_configured": channelConfigured})
}

func UpdateTelegramAnnouncementTemplate(c *gin.Context) {
	var template service.AnnouncementTemplate
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if err := common.DecodeJson(c.Request.Body, &template); err != nil {
		announcementError(c, service.ErrAnnouncementInvalid)
		return
	}
	if err := service.SaveAnnouncementTemplate(template); err != nil {
		announcementError(c, err)
		return
	}
	common.ApiSuccess(c, template)
}

func PreviewTelegramAnnouncement(c *gin.Context) {
	var input service.AnnouncementInput
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32768)
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		announcementError(c, service.ErrAnnouncementInvalid)
		return
	}
	preview, err := service.PreviewAnnouncement(input)
	if err != nil {
		announcementError(c, err)
		return
	}
	common.ApiSuccess(c, preview)
}

func PublishTelegramAnnouncement(c *gin.Context) {
	var request service.AnnouncementPublishRequest
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32768)
	if err := common.DecodeJson(c.Request.Body, &request); err != nil {
		announcementError(c, service.ErrAnnouncementInvalid)
		return
	}
	record, err := service.PublishAnnouncement(c.Request.Context(), c.GetInt("id"), request)
	if err != nil {
		announcementError(c, err)
		return
	}
	common.ApiSuccess(c, record)
}

func ListTelegramAnnouncements(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	if page < 1 || page > 100000 {
		page = 1
	}
	records, total, err := model.ListTelegramAnnouncements(page, 20)
	if err != nil {
		announcementError(c, err)
		return
	}
	for i := range records {
		// A crash after reservation must remain visible as uncertain, never retried.
		if (records[i].Status == "sending" || records[i].Status == "prepared") && records[i].CreatedAt < time.Now().Unix()-60 {
			records[i].Status = "unknown"
		}
		if records[i].ChannelRequested && (records[i].ChannelStatus == "sending" || records[i].ChannelStatus == "queued") && records[i].CreatedAt < time.Now().Unix()-120 {
			records[i].ChannelStatus = "unknown"
		}
	}
	common.ApiSuccess(c, gin.H{"items": records, "total": total, "page": page, "page_size": 20})
}
