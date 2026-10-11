package middleware

import (
	"fmt"
	"net"
	"net/http"
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
