package middleware

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

type PlaygroundAgentProfile string

const (
	PlaygroundAgentPrompt PlaygroundAgentProfile = "prompt"
	PlaygroundAgentImage  PlaygroundAgentProfile = "image"
)

// PlaygroundModel pins an agent-mode request to a server-selected model.
// The value is read by distribution and request validation, so a client
// supplied model cannot influence channel selection or upstream routing.
func PlaygroundModel(modelName string) gin.HandlerFunc {
	return func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyPlaygroundModel, modelName)
		c.Next()
	}
}

// PlaygroundAgent resolves a user-selected API key and model before channel
// distribution. This keeps the key secret on the server while allowing the
// normal token group/model-limit rules to select the correct channel.
func PlaygroundAgent(profile PlaygroundAgentProfile) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetBool("use_access_token") {
			abortWithOpenAiMessage(c, http.StatusForbidden, "image studio requires a dashboard login session")
			return
		}

		setting, err := model.GetUserSetting(c.GetInt("id"), false)
		if err != nil {
			abortWithOpenAiMessage(c, http.StatusInternalServerError, "failed to load image studio settings")
			return
		}
		agent := playgroundAgentSetting(setting.ImagePlayground, profile)
		requestedGroup := ""
		if profile == PlaygroundAgentImage && c.GetHeader("X-Studio-Group") != "" {
			requestedGroup, err = url.QueryUnescape(c.GetHeader("X-Studio-Group"))
			groupProfile, known := service.GetImageStudioProfile(requestedGroup)
			userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
			if err != nil || !known || !service.IsUserSelectableGroup(userGroup, requestedGroup) {
				common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("the selected image studio group is unavailable"))
				c.Abort()
				return
			}
			models, modelErr := model.GetImageStudioModels(requestedGroup)
			modelName := strings.TrimSpace(c.GetHeader("X-Studio-Model"))
			if modelErr != nil || !slices.Contains(models, modelName) {
				common.ApiErrorStatus(c, http.StatusBadRequest, common.NewMessage("the selected model is not available in this image group"))
				c.Abort()
				return
			}
			token, tokenErr := model.GetImageStudioToken(c.GetInt("id"), requestedGroup)
			if tokenErr != nil || token.Group != requestedGroup {
				common.ApiErrorStatus(c, http.StatusForbidden, common.NewMessage("the selected image studio API key is unavailable"))
				c.Abort()
				return
			}
			if err := validateStudioImageParameters(c, groupProfile); err != nil {
				common.ApiErrorStatus(c, http.StatusBadRequest, err)
				c.Abort()
				return
			}
			agent = &dto.ImagePlaygroundAgent{TokenId: token.Id, Model: modelName}
		}
		if agent == nil || agent.TokenId <= 0 || strings.TrimSpace(agent.Model) == "" {
			abortWithOpenAiMessage(c, http.StatusBadRequest, fmt.Sprintf("configure the %s API key and model in image studio settings first", profile))
			return
		}

		token, err := model.GetTokenByIds(agent.TokenId, c.GetInt("id"))
		if err != nil {
			abortWithOpenAiMessage(c, http.StatusBadRequest, "the selected image studio API key is invalid")
			return
		}
		validated, err := model.ValidateUserToken(token.Key)
		if err != nil || validated == nil || validated.UserId != c.GetInt("id") {
			abortWithOpenAiMessage(c, http.StatusForbidden, "the selected image studio API key is unavailable")
			return
		}
		token = validated
		if requestedGroup != "" && token.Group != requestedGroup {
			abortWithOpenAiMessage(c, http.StatusForbidden, "the selected image studio group is unavailable")
			return
		}
		if allowedIPs := token.GetIpLimits(); len(allowedIPs) > 0 {
			ip := net.ParseIP(c.ClientIP())
			if ip == nil || !common.IsIpInCIDRList(ip, allowedIPs) {
				abortWithOpenAiMessage(c, http.StatusForbidden, "your IP is not allowed by the selected image studio API key")
				return
			}
		}
		modelName := strings.TrimSpace(agent.Model)
		if token.ModelLimitsEnabled && !token.GetModelLimitsMap()[modelName] {
			abortWithOpenAiMessage(c, http.StatusForbidden, fmt.Sprintf("the selected API key does not allow model %s", modelName))
			return
		}

		userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
		usingGroup := token.Group
		if usingGroup == "" {
			usingGroup = userGroup
		}
		if usingGroup != "" && usingGroup != "auto" {
			if _, ok := service.GetUserUsableGroups(userGroup)[usingGroup]; !ok || !ratio_setting.ContainsGroupRatio(usingGroup) {
				abortWithOpenAiMessage(c, http.StatusForbidden, "the selected API key group is no longer available")
				return
			}
		}
		if err := SetupContextForToken(c, token); err != nil {
			abortWithOpenAiMessage(c, http.StatusForbidden, "failed to prepare the selected image studio API key")
			return
		}
		common.SetContextKey(c, constant.ContextKeyUsingGroup, usingGroup)
		common.SetContextKey(c, constant.ContextKeyPlaygroundModel, modelName)
		common.SetContextKey(c, constant.ContextKeyPlaygroundProfile, string(profile))
		c.Next()
	}
}

func playgroundAgentSetting(setting *dto.ImagePlaygroundSetting, profile PlaygroundAgentProfile) *dto.ImagePlaygroundAgent {
	if setting == nil {
		return nil
	}
	if profile == PlaygroundAgentPrompt {
		return setting.Prompt
	}
	if profile == PlaygroundAgentImage {
		return setting.Image
	}
	return nil
}

// PlaygroundPath presents an agent-mode request to relay middleware using a
// canonical OpenAI path while preserving the public route in the final response.
func PlaygroundPath(path string) gin.HandlerFunc {
	return func(c *gin.Context) {
		originalPath := c.Request.URL.Path
		originalRawPath := c.Request.URL.RawPath
		c.Request.URL.Path = path
		c.Request.URL.RawPath = ""
		c.Next()
		c.Request.URL.Path = originalPath
		c.Request.URL.RawPath = originalRawPath
	}
}

// Apply the same bounds to JSON generation and multipart edits before routing
// and billing. The relay retains its own count validation as a second boundary.
func validateStudioImageParameters(c *gin.Context, profile service.ImageStudioProfile) error {
	var input struct {
		Parameters json.RawMessage `json:"parameters"`
		Size       string          `json:"size"`
		Quality    string          `json:"quality"`
		Format     string          `json:"output_format"`
		Background string          `json:"background"`
		N          *uint           `json:"n"`
	}
	if strings.Contains(c.ContentType(), "multipart/form-data") {
		form, err := common.ParseMultipartFormReusable(c)
		if err != nil {
			return common.NewMessage("invalid image studio parameters")
		}
		values := url.Values(form.Value)
		if values.Has("parameters") {
			return common.NewMessage("invalid image studio parameters")
		}
		for _, name := range []string{"size", "quality", "output_format", "background", "n"} {
			if len(values[name]) > 1 {
				return common.NewMessage("invalid image studio parameters")
			}
		}
		input.Size, input.Quality, input.Format, input.Background = values.Get("size"), values.Get("quality"), values.Get("output_format"), values.Get("background")
		if values.Has("n") {
			n, err := strconv.ParseUint(values.Get("n"), 10, 32)
			if err != nil || n < 1 || n > dto.MaxImageN {
				return common.NewMessage("invalid image count")
			}
			value := uint(n)
			input.N = &value
		}
	} else if err := common.UnmarshalBodyReusable(c, &input); err != nil {
		return common.NewMessage("invalid image studio parameters")
	}
	if len(input.Parameters) > 0 {
		return common.NewMessage("invalid image studio parameters")
	}
	if input.N != nil && (*input.N < 1 || *input.N > dto.MaxImageN) {
		return common.NewMessage("invalid image count")
	}
	if !slices.Contains([]string{"", "auto", "low", "medium", "high"}, input.Quality) || !slices.Contains([]string{"", "png", "jpeg", "webp"}, input.Format) || !slices.Contains([]string{"", "auto", "opaque", "transparent"}, input.Background) {
		return common.NewMessage("invalid image studio parameters")
	}
	if input.Format == "jpeg" && input.Background == "transparent" {
		return common.NewMessage("JPEG does not support transparency")
	}
	if input.Size == "" || input.Size == "auto" {
		return nil
	}
	widthText, heightText, ok := strings.Cut(input.Size, "x")
	width, widthErr := strconv.Atoi(widthText)
	height, heightErr := strconv.Atoi(heightText)
	maxEdge := profile.MaxResolution * 1024
	if profile.SizeMode == "native" {
		maxEdge = 3840
	}
	if !ok || widthErr != nil || heightErr != nil || width < 256 || height < 256 || width > maxEdge || height > maxEdge || width%16 != 0 || height%16 != 0 {
		return common.NewMessage("the selected image size is not supported by this group")
	}
	if profile.SizeMode == "native" && width*height > 8294400 {
		return common.NewMessage("the selected image size is not supported by this group")
	}
	return nil
}
