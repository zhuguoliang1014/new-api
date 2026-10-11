package middleware

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"github.com/gin-gonic/gin"
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
