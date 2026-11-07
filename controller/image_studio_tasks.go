package controller

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

var imageStudioTasks *service.StudioTaskStore

func StartImageStudioTasks() error {
	root := os.Getenv("IMAGE_STUDIO_STORAGE_DIR")
	if root == "" {
		root = "./image-studio"
	}
	store, err := service.NewStudioTaskStore(root, relayStudioTask)
	if err != nil {
		return err
	}
	imageStudioTasks = store
	go store.Run(context.Background())
	return nil
}

// Build a fresh request without browser credentials. Current account and API
// key permissions are rechecked by the same middleware used by /pg/images.
func relayStudioTask(ctx context.Context, request service.StudioTaskRequest, body io.Reader, writer http.ResponseWriter) error {
	user, err := model.GetUserCache(request.OwnerID)
	if err != nil {
		return err
	}
	if user.Status != common.UserStatusEnabled {
		return errors.New("image task owner is disabled")
	}
	path := "/pg/images/generations"
	if request.Edit {
		path = "/pg/images/edits"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", request.ContentType)
	req.Header.Set("X-Studio-Group", url.QueryEscape(request.Group))
	req.Header.Set("X-Studio-Model", request.Model)
	req.RemoteAddr = net.JoinHostPort(request.ClientIP, "0")
	engine := gin.New()
	_ = engine.SetTrustedProxies(nil)
	engine.Use(gin.Recovery(), middleware.RequestId(), middleware.BodyStorageCleanup())
	engine.Use(func(c *gin.Context) {
		c.Set("id", user.Id)
		c.Set("username", user.Username)
		c.Set("role", user.Role)
		c.Set("group", user.Group)
		c.Set("user_group", user.Group)
		user.WriteContext(c)
		c.Next()
	})
	engine.POST(path, middleware.PlaygroundAgent(middleware.PlaygroundAgentImage), middleware.Distribute(), PlaygroundImage)
	engine.ServeHTTP(writer, req)
	return nil
}

func ImageStudioTasksAvailable(c *gin.Context) {
	if c.GetBool("use_access_token") {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	if imageStudioTasks == nil {
		c.AbortWithStatus(http.StatusServiceUnavailable)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Next()
}

func CreateImageStudioTask(c *gin.Context) {
	group, groupErr := url.QueryUnescape(c.GetHeader("X-Studio-Group"))
	profile, known := service.GetImageStudioModelProfile(group, c.GetHeader("X-Studio-Model"))
	if groupErr != nil || !known {
		writePlaygroundError(c, 400, "invalid image task request")
		return
	}
	storage, err := common.GetBodyStorage(c)
	if err != nil {
		writePlaygroundError(c, 400, "invalid image task request")
		return
	}
	if storage.Size() > service.ImageStudioMaxBody {
		writePlaygroundError(c, 413, "image task request is too large")
		return
	}
	reader, err := storage.NewReader()
	if err != nil {
		writePlaygroundError(c, 500, "image task storage is unavailable")
		return
	}
	defer reader.Close()
	body, err := io.ReadAll(io.LimitReader(reader, service.ImageStudioMaxBody+1))
	if err != nil || len(body) > service.ImageStudioMaxBody {
		writePlaygroundError(c, 413, "image task request is too large")
		return
	}
	var metadata json.RawMessage
	var mjOptions service.StudioMJOptions
	count := 1
	references := 0
	maxReferences := 4
	if profile.SizeMode == "ratio" {
		maxReferences = 5
	}
	contentType := c.GetHeader("Content-Type")
	size, quality, format, background, prompt := "auto", "auto", "png", "auto", ""
	if service.IsImageStudioOutputFormatSupported(c.GetHeader("X-Studio-Model"), "auto") {
		format = "auto"
	}
	if strings.Contains(c.ContentType(), "multipart/form-data") {
		if profile.SizeMode == "ratio" {
			writePlaygroundError(c, 400, "invalid image task request")
			return
		}
		form, err := common.ParseMultipartFormReusable(c)
		if err != nil || len(form.Value["studio_metadata"]) != 1 {
			writePlaygroundError(c, 400, "invalid image task metadata")
			return
		}
		defer form.RemoveAll()
		metadata = []byte(form.Value["studio_metadata"][0])
		values := url.Values(form.Value)
		prompt = values.Get("prompt")
		if v := values.Get("size"); v != "" {
			size = v
		}
		if v := values.Get("quality"); v != "" {
			quality = v
		}
		if v := values.Get("output_format"); v != "" {
			format = v
		}
		if v := values.Get("background"); v != "" {
			background = v
		}
		if values := form.Value["n"]; len(values) > 0 {
			count, err = strconv.Atoi(values[0])
			if err != nil {
				count = 0
			}
		}
		if values := form.Value["stream"]; len(values) > 1 || (len(values) == 1 && values[0] != "false") {
			writePlaygroundError(c, 400, "invalid image task request")
			return
		}
		body, contentType, references, err = encodeStudioRelayForm(form, contentType)
		if err != nil {
			reason, message := "encoding_failed", "invalid image task request"
			switch {
			case errors.Is(err, errStudioReferenceEmpty):
				reason, message = "empty_reference", "Could not read the reference image. Select it again and retry."
			case errors.Is(err, errStudioReferenceSize):
				reason, message = "oversized_reference", "Each reference image must be smaller than 10 MB."
			case errors.Is(err, errStudioReferenceType):
				reason, message = "unsupported_reference_type", "Upload PNG, JPEG or WebP images."
			}
			// Record only a bounded reason; never log prompts, image data or credentials.
			logger.LogWarn(c.Request.Context(), common.LogText("image_studio_task_rejected user_id=%d stage=reference_upload reason=%s", c.GetInt("id"), reason))
			writePlaygroundError(c, 400, message)
			return
		}
	} else {
		var payload struct {
			service.StudioMJOptions
			Metadata   json.RawMessage `json:"studio_metadata"`
			Stream     bool            `json:"stream"`
			Count      *int            `json:"n"`
			Prompt     string          `json:"prompt"`
			Size       string          `json:"size"`
			Quality    string          `json:"quality"`
			Format     string          `json:"output_format"`
			Background string          `json:"background"`
			Images     []string        `json:"images"`
		}
		if common.Unmarshal(body, &payload) != nil || payload.Stream {
			writePlaygroundError(c, 400, "invalid image task request")
			return
		}
		var fields map[string]json.RawMessage
		if err = common.Unmarshal(body, &fields); err != nil {
			writePlaygroundError(c, 400, "invalid image task request")
			return
		}
		delete(fields, "studio_metadata")
		body, err = common.Marshal(fields)
		if err != nil {
			writePlaygroundError(c, 400, "invalid image task request")
			return
		}
		metadata = payload.Metadata
		prompt = payload.Prompt
		if payload.Size != "" {
			size = payload.Size
		}
		if payload.Quality != "" {
			quality = payload.Quality
		}
		if payload.Format != "" {
			format = payload.Format
		}
		if payload.Background != "" {
			background = payload.Background
		}
		if payload.Count != nil {
			count = *payload.Count
		}
		if profile.SizeMode == "ratio" {
			mjOptions = payload.StudioMJOptions
			if mjOptions.Validate() != nil {
				writePlaygroundError(c, 400, "invalid image task request")
				return
			}
			references = len(payload.Images)
			if references > maxReferences || utf8.RuneCountInString(prompt) > 1023 {
				writePlaygroundError(c, 400, "invalid image task request")
				return
			}
			for _, source := range payload.Images {
				header, data, ok := strings.Cut(source, ",")
				if !ok || !slices.Contains([]string{"data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"}, header) || len(data) > base64.StdEncoding.EncodedLen(10<<20) {
					writePlaygroundError(c, 400, "invalid reference image")
					return
				}
				decoded, err := base64.StdEncoding.DecodeString(data)
				if err != nil || len(decoded) == 0 || len(decoded) > 10<<20 {
					writePlaygroundError(c, 400, "invalid reference image")
					return
				}
			}
			// MJ accepts references on the JSON generations endpoint. Keep the
			// fixed-price HD tier pinned independently of browser fields.
			request := struct {
				service.StudioMJOptions
				Prompt         string   `json:"prompt"`
				Count          int      `json:"n"`
				Size           string   `json:"size"`
				Quality        string   `json:"quality"`
				HD             bool     `json:"hd"`
				ResponseFormat string   `json:"response_format"`
				Images         []string `json:"images,omitempty"`
			}{StudioMJOptions: mjOptions, Prompt: prompt, Count: 1, Size: size, Quality: "1", HD: true, ResponseFormat: "url", Images: payload.Images}
			body, err = common.Marshal(request)
			if err != nil {
				writePlaygroundError(c, 400, "invalid image task request")
				return
			}
		}
	}
	var meta struct {
		Parameters struct {
			MJ         *service.StudioMJOptions `json:"mj,omitempty"`
			Prompt     string                   `json:"prompt"`
			Count      int                      `json:"count"`
			Model      string                   `json:"model"`
			Group      string                   `json:"group"`
			Size       string                   `json:"size"`
			Format     string                   `json:"format"`
			Quality    string                   `json:"quality"`
			Background string                   `json:"background"`
		} `json:"parameters"`
		ReferenceCount int     `json:"referenceCount"`
		StyleID        *string `json:"styleId"`
	}
	if len(metadata) > 128<<10 || common.Unmarshal(metadata, &meta) != nil || strings.TrimSpace(meta.Parameters.Prompt) == "" || strings.TrimSpace(prompt) == "" || len(prompt) > 128<<10 {
		writePlaygroundError(c, 400, "invalid image task metadata")
		return
	}
	if count < 1 || count > 4 || count != meta.Parameters.Count || meta.ReferenceCount < 0 || meta.ReferenceCount > maxReferences || meta.ReferenceCount != references {
		writePlaygroundError(c, 400, "invalid image task metadata")
		return
	}
	if profile.MaxCount > 0 && count > profile.MaxCount {
		writePlaygroundError(c, 400, "invalid image count")
		return
	}
	if meta.Parameters.MJ != nil {
		if profile.SizeMode != "ratio" || meta.Parameters.MJ.Validate() != nil {
			writePlaygroundError(c, 400, "invalid image task metadata")
			return
		}
	}
	metadataOptions := service.StudioMJOptions{}
	if meta.Parameters.MJ != nil {
		metadataOptions = *meta.Parameters.MJ
	}
	if !reflect.DeepEqual(metadataOptions, mjOptions) {
		writePlaygroundError(c, 400, "invalid image task metadata")
		return
	}
	if profile.SizeMode == "ratio" && (quality != "auto" || format != "png" || background != "auto") {
		writePlaygroundError(c, 400, "invalid image task metadata")
		return
	}
	if meta.Parameters.Model != c.GetHeader("X-Studio-Model") || meta.Parameters.Size != size || meta.Parameters.Format != format || meta.Parameters.Quality != quality || meta.Parameters.Background != background {
		writePlaygroundError(c, 400, "invalid image task metadata")
		return
	}
	if !slices.Contains([]string{"auto", "low", "medium", "high"}, quality) || !service.IsImageStudioOutputFormatSupported(meta.Parameters.Model, format) || !slices.Contains([]string{"auto", "opaque", "transparent"}, background) {
		writePlaygroundError(c, 400, "invalid image task metadata")
		return
	}
	if (c.Param("kind") == "edits") != (references > 0) {
		writePlaygroundError(c, 400, "invalid image task request")
		return
	}
	if group != meta.Parameters.Group {
		writePlaygroundError(c, 400, "invalid image task request")
		return
	}
	metadata, err = common.Marshal(meta)
	if err != nil {
		writePlaygroundError(c, 400, "invalid image task metadata")
		return
	}
	task, err := imageStudioTasks.Submit(c.GetHeader("X-Studio-Task-ID"), service.StudioTaskRequest{OwnerID: c.GetInt("id"), ClientIP: c.ClientIP(), Group: group, Model: c.GetHeader("X-Studio-Model"), ContentType: contentType, Edit: c.Param("kind") == "edits" && profile.SizeMode != "ratio"}, metadata, body)
	if err != nil {
		message := "image task storage is unavailable"
		if err.Error() == "image task queue is full" || err.Error() == "image task storage is full" || err.Error() == "image task ID already exists" || err.Error() == "invalid image task request" {
			message = err.Error()
		}
		writePlaygroundError(c, 409, message)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"success": true, "data": task})
}
func ListImageStudioTasks(c *gin.Context) {
	c.JSON(200, gin.H{"success": true, "data": imageStudioTasks.List(c.GetInt("id"))})
}
func GetImageStudioTask(c *gin.Context) {
	task, err := imageStudioTasks.Get(c.GetInt("id"), c.Param("id"))
	if err != nil {
		c.Status(404)
		return
	}
	c.JSON(200, gin.H{"success": true, "data": task})
}
func DeleteImageStudioTask(c *gin.Context) {
	if err := imageStudioTasks.Delete(c.GetInt("id"), c.Param("id")); err != nil {
		if errors.Is(err, service.ErrStudioTaskNotFound) {
			c.Status(404)
		} else {
			c.Status(409)
		}
		return
	}
	c.Status(204)
}
func RetryImageStudioDownload(c *gin.Context) {
	if err := imageStudioTasks.RetryDownload(c.GetInt("id"), c.Param("id")); err != nil {
		if errors.Is(err, service.ErrStudioTaskNotFound) {
			c.Status(404)
		} else {
			c.Status(409)
		}
		return
	}
	c.Status(202)
}
func DownloadImageStudioImage(c *gin.Context) {
	index, err := strconv.Atoi(c.Param("index"))
	if err != nil {
		c.Status(404)
		return
	}
	thumbnail := c.Query("thumbnail") == "1"
	file, info, err := imageStudioTasks.Image(c.GetInt("id"), c.Param("id"), index, thumbnail)
	if err != nil {
		c.Status(404)
		return
	}
	defer file.Close()
	contentType := info.ContentType
	if thumbnail {
		contentType = "image/jpeg"
	}
	c.Header("Content-Type", contentType)
	c.Header("X-Content-Type-Options", "nosniff")
	http.ServeContent(c.Writer, c.Request, "image", time.Time{}, file)
}
