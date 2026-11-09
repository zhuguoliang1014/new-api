package controller

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strconv"

	"context"
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

var studioEventID = regexp.MustCompile(`^[a-zA-Z0-9_-]{16,64}$`)
var studioEventAssetID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

type studioClientEvent struct {
	EventID string `json:"event_id"`
	Action  string `json:"action"`
	Mode    string `json:"mode"`
	Role    string `json:"role,omitempty"`
	AssetID string `json:"asset_id,omitempty"`
}

// A small allowlist prevents prompts, image data, filenames and credentials from entering usage events.
func RecordImageStudioEvent(c *gin.Context) {
	if c.GetBool("use_access_token") {
		c.Status(http.StatusForbidden)
		return
	}
	var event studioClientEvent
	reader := http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if decoder.Decode(&event) != nil || decoder.Decode(&struct{}{}) != io.EOF || !studioEventID.MatchString(event.EventID) || !slices.Contains([]string{"page_opened", "mode_selected", "library_opened", "reference_selected", "assistant_opened"}, event.Action) || !slices.Contains([]string{"general", "portrait"}, event.Mode) || (event.Role != "" && !slices.Contains([]string{"identity", "outfit", "pose", "scene", "subject"}, event.Role)) || (event.AssetID != "" && !studioEventAssetID.MatchString(event.AssetID)) {
		c.Status(http.StatusBadRequest)
		return
	}
	params := model.AuditFields{"mode": event.Mode}
	if event.Role != "" {
		params["reference_role"] = event.Role
	}
	if event.AssetID != "" {
		params["asset_id"] = event.AssetID
	}
	// Authenticated user ID is part of the deduplication identity, never selected by the browser.
	id := sha256.Sum256([]byte(event.EventID + ":" + strconv.Itoa(c.GetInt("id"))))
	entry := model.AuditLog{EventId: hex.EncodeToString(id[:]), UserId: c.GetInt("id"), Username: c.GetString("username"), ActorRole: c.GetInt("role"), Category: "image_studio", Action: "studio." + event.Action, Content: studioEventContent(event.Action), Success: true, Status: http.StatusNoContent, Other: model.AuditOther{Op: &model.AuditOperation{Action: "studio." + event.Action, Params: params}}}
	model.RecordAuditLog(c, entry)
	c.Status(http.StatusNoContent)
}
func studioEventContent(action string) string {
	switch action {
	case "page_opened":
		return "Opened creative studio"
	case "mode_selected":
		return "Selected a creative studio mode"
	case "library_opened":
		return "Browsed the reference library"
	case "reference_selected":
		return "Selected a creative reference"
	case "assistant_opened":
		return "Opened the creative assistant"
	case "accepted":
		return "Creative request accepted"
	case "ready":
		return "Creative images ready"
	case "download_failed":
		return "Creative image download failed"
	default:
		return "Creative image generation failed"
	}
}

func recordStudioTaskEvent(event service.StudioTaskEvent) {
	var meta struct {
		ReferenceCount int `json:"referenceCount"`
		Parameters     struct {
			Count int `json:"count"`
		} `json:"parameters"`
		CreativeContext *struct {
			TaskType string `json:"taskType"`
		} `json:"creativeContext"`
	}
	_ = json.Unmarshal(event.Task.Metadata, &meta)
	mode := "general"
	if meta.CreativeContext != nil && meta.CreativeContext.TaskType == "portrait" {
		mode = "portrait"
	}
	logger.LogInfo(context.Background(), common.LogText("image_studio_event action=%s user_id=%d task_id=%s mode=%s model=%s references=%d results=%d", event.Action, event.Request.OwnerID, event.Task.ID, mode, event.Request.Model, meta.ReferenceCount, len(event.Task.Images)))
	user, err := model.GetUserCache(event.Request.OwnerID)
	if err != nil || user == nil {
		return
	}
	params := model.AuditFields{"mode": mode, "task_id": event.Task.ID, "model": event.Request.Model, "reference_count": meta.ReferenceCount, "requested_count": meta.Parameters.Count, "result_count": len(event.Task.Images)}
	model.RecordAuditLog(nil, model.AuditLog{UserId: user.Id, Username: user.Username, ActorRole: user.Role, Category: "image_studio", Action: "studio." + event.Action, Content: studioEventContent(event.Action), Success: event.Action == "accepted" || event.Action == "ready", Other: model.AuditOther{Op: &model.AuditOperation{Action: "studio." + event.Action, Params: params}}})
}
