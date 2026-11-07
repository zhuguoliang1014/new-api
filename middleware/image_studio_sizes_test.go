package middleware

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStudioVerifiedSizeBoundary(t *testing.T) {
	for _, tc := range []struct {
		group, size string
		valid       bool
	}{
		{"【生图】超分基础版1-4k", "4096x4096", true},
		{"【生图】超分基础版1-4k", "4112x2320", false},
		{"【生图】超分高质量1-10k", "4096x4096", true},
		{"【生图】超分高质量1-10k", "8192x8192", false},
		{"【生图】超分高质量1-10k", "8208x4624", false},
		{"【生图】超分高质量1-10k", "10240x5760", false},
		{"【生图】超分高质量1-10k", "8192x256", false},
		{"【生图】官逆原生1-4k", "3840x2160", true},
		{"【生图】官逆原生1-4k", "4096x2304", false},
	} {
		t.Run(tc.group+tc.size, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/", strings.NewReader(`{"size":"`+tc.size+`"}`))
			c.Request.Header.Set("Content-Type", "application/json")
			profile, ok := service.GetImageStudioProfile(tc.group)
			require.True(t, ok)
			err := validateStudioImageParameters(c, profile)
			if storage, ok := c.Get(common.KeyBodyStorage); ok {
				storage.(common.BodyStorage).Close()
			}
			assert.Equal(t, tc.valid, err == nil, "size %s error=%v", tc.size, err)
		})
	}
}

func TestStudioGIFParameterValidation(t *testing.T) {
	for _, tc := range []struct {
		model string
		valid bool
	}{
		{"gpt-image-2.6-basic", true}, {"gpt-image-2-basic", false}, {"gpt-image-2.5-flare-native", false}, {"gpt-image-2.6-native", false},
	} {
		t.Run(tc.model, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/", strings.NewReader(`{"size":"1024x1024","output_format":"gif"}`))
			c.Request.Header.Set("Content-Type", "application/json")
			c.Request.Header.Set("X-Studio-Model", tc.model)
			profile, ok := service.GetImageStudioModelProfile(service.ImageStudioGroup, tc.model)
			require.True(t, ok)
			err := validateStudioImageParameters(c, profile)
			if storage, ok := c.Get(common.KeyBodyStorage); ok {
				storage.(common.BodyStorage).Close()
			}
			assert.Equal(t, tc.valid, err == nil, "error=%v", err)
		})
	}
}
