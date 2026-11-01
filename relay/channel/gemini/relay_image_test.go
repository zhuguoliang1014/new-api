package gemini

import (
	"bytes"
	"encoding/base64"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	appconstant "github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestGeminiImageProtocolConversion(t *testing.T) {
	for _, model := range []string{"gemini-nano-banana-2.1", "gemini-3-pro-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image", "gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"} {
		t.Run(model, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/v1/images/generations", nil)
			c.Request.Header.Set("Content-Type", "application/json")
			info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesGenerations, ChannelMeta: &relaycommon.ChannelMeta{ChannelType: appconstant.ChannelTypeGemini, ChannelBaseUrl: "https://upstream.example", UpstreamModelName: model, ApiKey: "fixture-key"}}
			adaptor := &Adaptor{}
			request, err := adaptor.ConvertImageRequest(c, info, dto.ImageRequest{Model: model, Prompt: "A cat", Size: "4096x2304", N: common.GetPointer(uint(1))})
			require.NoError(t, err)
			encoded, err := common.Marshal(request)
			require.NoError(t, err)
			assert.Equal(t, "A cat", gjson.GetBytes(encoded, "contents.0.parts.0.text").String())
			assert.Equal(t, "IMAGE", gjson.GetBytes(encoded, "generationConfig.responseModalities.0").String())
			assert.Equal(t, "16:9", gjson.GetBytes(encoded, "generationConfig.imageConfig.aspectRatio").String())
			assert.Equal(t, "4K", gjson.GetBytes(encoded, "generationConfig.imageConfig.imageSize").String())
			assert.EqualValues(t, 1, gjson.GetBytes(encoded, "generationConfig.candidateCount").Int())
			target, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, "https://upstream.example/v1beta/models/"+model+":generateContent", target)
			header := http.Header{}
			require.NoError(t, adaptor.SetupRequestHeader(c, &header, info))
			assert.Equal(t, "fixture-key", header.Get("x-goog-api-key"))
			assert.Equal(t, "application/json", header.Get("Content-Type"))
		})
	}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/images/generations", nil)
	for _, request := range []dto.ImageRequest{{Prompt: "cat", N: common.GetPointer(uint(2))}, {Prompt: "cat", N: common.GetPointer(uint(dto.MaxImageN + 1))}, {Prompt: "cat", Size: "8192x8192"}, {Prompt: "cat", Size: "-1x1024"}, {Prompt: "cat", Stream: common.GetPointer(true)}, {Prompt: ""}} {
		_, err := convertGeminiImageRequest(c, request)
		require.Error(t, err)
	}
	// Existing Imagen traffic keeps its predict protocol and batch count.
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{UpstreamModelName: "imagen-4.0-generate-001", ChannelBaseUrl: "https://upstream.example"}}
	request, err := (&Adaptor{}).ConvertImageRequest(c, info, dto.ImageRequest{Prompt: "cat", N: common.GetPointer(uint(2))})
	require.NoError(t, err)
	assert.Equal(t, 2, request.(dto.GeminiImageRequest).Parameters.SampleCount)
	target, err := (&Adaptor{}).GetRequestURL(info)
	require.NoError(t, err)
	assert.Contains(t, target, ":predict")
}

func TestGeminiImageReferenceConversion(t *testing.T) {
	const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII="
	data, err := base64.StdEncoding.DecodeString(pixel)
	require.NoError(t, err)
	var form bytes.Buffer
	writer := multipart.NewWriter(&form)
	for range 2 {
		part, err := writer.CreateFormFile("image[]", "pixel.png")
		require.NoError(t, err)
		_, err = part.Write(data)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/images/edits", &form)
	c.Request.Header.Set("Content-Type", writer.FormDataContentType())
	request, err := convertGeminiImageRequest(c, dto.ImageRequest{Prompt: "Make it blue", Size: "2K"})
	require.NoError(t, err)
	defer c.Request.MultipartForm.RemoveAll()
	require.Len(t, request.Contents[0].Parts, 3)
	for _, part := range request.Contents[0].Parts[1:] {
		require.NotNil(t, part.InlineData)
		assert.Equal(t, pixel, part.InlineData.Data)
		assert.Equal(t, "image/png", part.InlineData.MimeType)
	}
	assert.Equal(t, "application/json", c.GetHeader("Content-Type"))
	c.Request = httptest.NewRequest("POST", "/v1/images/edits", nil)
	c.Request.Header.Set("Content-Type", "application/json")
	for _, images := range []any{[]string{"data:image/png;base64," + pixel, "https://example.com/reference.png"}, []map[string]string{{"image_url": "data:image/png;base64," + pixel}, {"image_url": "https://example.com/reference.png"}}} {
		encoded, err := common.Marshal(images)
		require.NoError(t, err)
		request, err := convertGeminiImageRequest(c, dto.ImageRequest{Prompt: "cat", Images: encoded})
		require.NoError(t, err)
		require.Len(t, request.Contents[0].Parts, 3)
		assert.Equal(t, pixel, request.Contents[0].Parts[1].InlineData.Data)
		assert.Equal(t, "https://example.com/reference.png", request.Contents[0].Parts[2].FileData.FileUri)
		assert.Equal(t, "image/png", request.Contents[0].Parts[2].FileData.MimeType)
	}
	for _, images := range [][]string{{"file:///etc/passwd"}, {"data:image/png;base64,invalid"}, {"https://user:pass@example.com/image.png"}, {}} {
		encoded, err := common.Marshal(images)
		require.NoError(t, err)
		_, err = convertGeminiImageRequest(c, dto.ImageRequest{Prompt: "cat", Images: encoded})
		require.Error(t, err)
	}
}

func TestGeminiImageResponseConversionAndEmptyFailure(t *testing.T) {
	for _, field := range []string{"inlineData", "inline_data"} {
		t.Run(field, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			count := 1
			info := &relaycommon.RelayInfo{RelayMode: relayconstant.RelayModeImagesGenerations, PriceData: types.PriceData{UsePrice: true}, TieredBillingSnapshot: &billingexpr.BillingSnapshot{EstimatedImageCount: &count}}
			payload := map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"text": "ignored"}, map[string]any{"thought": true, field: map[string]string{"mime_type": "image/png", "data": "aGVsbG8="}}, map[string]any{field: map[string]string{"mime_type": "image/png", "data": "aW1hZ2U="}}, map[string]any{field: map[string]string{"mimeType": "image/jpeg", "data": "aW1hZ2Uy"}}}}}}, "usageMetadata": map[string]int{"promptTokenCount": 17, "candidatesTokenCount": 20, "totalTokenCount": 37}}
			encoded, err := common.Marshal(payload)
			require.NoError(t, err)
			body := string(encoded)
			response := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(body))}
			usage, apiErr := GeminiGenerativeImageHandler(c, info, response)
			require.Nil(t, apiErr)
			require.NotNil(t, usage)
			assert.Equal(t, 37, usage.TotalTokens)
			require.NotNil(t, info.BillingImageCount)
			assert.Equal(t, 2, *info.BillingImageCount)
			assert.Equal(t, 2.0, info.PriceData.OtherRatios()["n"])
			assert.Equal(t, "aW1hZ2U=", gjson.Get(recorder.Body.String(), "data.0.b64_json").String())
			assert.Equal(t, int64(2), gjson.Get(recorder.Body.String(), "data.#").Int())
		})
	}
	for _, payload := range []any{map[string]any{}, map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"text": "blocked"}}}}}}, map[string]any{"candidates": []any{map[string]any{"content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]string{"mimeType": "image/png", "data": "invalid!"}}}}}}}} {
		encoded, err := common.Marshal(payload)
		require.NoError(t, err)
		body := string(encoded)
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		_, apiErr := GeminiGenerativeImageHandler(c, &relaycommon.RelayInfo{}, &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))})
		require.NotNil(t, apiErr)
		assert.Equal(t, http.StatusBadGateway, apiErr.StatusCode)
		assert.False(t, c.Writer.Written())
	}
}
