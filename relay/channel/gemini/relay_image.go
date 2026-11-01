package gemini

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"net/url"
	"path"
	"slices"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// Convert OpenAI Images requests at a Gemini channel boundary. Clients and
// the workbench keep their existing endpoint, model and fixed-image billing.
func convertGeminiImageRequest(c *gin.Context, request dto.ImageRequest) (*dto.GeminiChatRequest, error) {
	count, err := request.ImageCount(false)
	if err != nil || count != 1 {
		return nil, types.NewErrorWithStatusCode(errors.New("Gemini image generation requires n=1"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if request.Stream != nil && *request.Stream {
		return nil, types.NewErrorWithStatusCode(errors.New("streaming Images requests are not supported by this Gemini channel"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if strings.TrimSpace(request.Prompt) == "" {
		return nil, types.NewErrorWithStatusCode(errors.New("prompt is required"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	parts := []dto.GeminiPart{{Text: request.Prompt}}
	var sources []string
	if len(request.Mask) > 0 && string(request.Mask) != "null" {
		return nil, types.NewErrorWithStatusCode(errors.New("Gemini image editing does not support masks"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
	}
	if strings.HasPrefix(c.GetHeader("Content-Type"), "multipart/form-data") {
		form, err := common.ParseMultipartFormReusable(c)
		if err != nil {
			return nil, err
		}
		c.Request.MultipartForm = form
		if len(form.File["mask"]) > 0 || len(form.Value["mask"]) > 0 {
			return nil, types.NewErrorWithStatusCode(errors.New("Gemini image editing does not support masks"), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
		}
		names := make([]string, 0, len(form.File))
		for name := range form.File {
			if name == "image" || name == "image[]" || strings.HasPrefix(name, "image[") {
				names = append(names, name)
			}
		}
		slices.Sort(names)
		for _, name := range names {
			for _, file := range form.File[name] {
				if len(parts) > 4 || file.Size > 10<<20 {
					return nil, fmt.Errorf("invalid reference image count or size")
				}
				reader, err := file.Open()
				if err != nil {
					return nil, err
				}
				data, readErr := io.ReadAll(io.LimitReader(reader, (10<<20)+1))
				_ = reader.Close()
				if readErr != nil {
					return nil, readErr
				}
				mime := http.DetectContentType(data)
				if len(data) == 0 || len(data) > 10<<20 || !slices.Contains([]string{"image/png", "image/jpeg", "image/webp"}, mime) {
					return nil, fmt.Errorf("invalid reference image")
				}
				parts = append(parts, dto.GeminiPart{InlineData: &dto.GeminiInlineData{MimeType: mime, Data: base64.StdEncoding.EncodeToString(data)}})
			}
		}
	} else {
		if len(request.Images) > 0 && string(request.Images) != "null" {
			var images []struct {
				ImageURL string `json:"image_url"`
			}
			if err := common.Unmarshal(request.Images, &sources); err != nil {
				sources = nil
				if err := common.Unmarshal(request.Images, &images); err != nil {
					return nil, fmt.Errorf("invalid reference images")
				}
				for _, image := range images {
					sources = append(sources, image.ImageURL)
				}
			}
		}
		if len(request.Image) > 0 && string(request.Image) != "null" {
			var source string
			if len(sources) > 0 || common.Unmarshal(request.Image, &source) != nil {
				return nil, fmt.Errorf("invalid reference image")
			}
			sources = append(sources, source)
		}
	}
	if len(parts)-1+len(sources) > 4 {
		return nil, fmt.Errorf("at most four reference images are supported")
	}
	for _, source := range sources {
		if strings.HasPrefix(source, "data:") {
			header, data, ok := strings.Cut(source, ",")
			mime, encoded := strings.CutSuffix(strings.TrimPrefix(header, "data:"), ";base64")
			if !ok || !encoded || !slices.Contains([]string{"image/png", "image/jpeg", "image/webp"}, mime) || len(data) > base64.StdEncoding.EncodedLen(10<<20) {
				return nil, fmt.Errorf("invalid reference image")
			}
			decoded, err := base64.StdEncoding.DecodeString(data)
			if err != nil || len(decoded) == 0 || len(decoded) > 10<<20 {
				return nil, fmt.Errorf("invalid reference image")
			}
			parts = append(parts, dto.GeminiPart{InlineData: &dto.GeminiInlineData{MimeType: mime, Data: data}})
		} else {
			parsed, err := url.Parse(source)
			if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.User != nil {
				return nil, fmt.Errorf("invalid reference image URL")
			}
			// Pass a file reference to Gemini rather than fetching a client URL here.
			mimeType := mime.TypeByExtension(strings.ToLower(path.Ext(parsed.Path)))
			if !slices.Contains([]string{"image/png", "image/jpeg", "image/webp"}, mimeType) {
				mimeType = "image/jpeg"
			}
			parts = append(parts, dto.GeminiPart{FileData: &dto.GeminiFileData{MimeType: mimeType, FileUri: source}})
		}
	}
	if strings.Contains(c.Request.URL.Path, "/edits") && len(parts) == 1 {
		return nil, fmt.Errorf("image is required")
	}
	config := map[string]string{}
	size := strings.TrimSpace(request.Size)
	switch size {
	case "", "auto":
	case "1K", "2K", "4K":
		config["imageSize"] = size
	default:
		ratios := []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"}
		if slices.Contains(ratios, size) {
			config["aspectRatio"] = size
			break
		}
		w, h, ok := strings.Cut(size, "x")
		width, ew := strconv.Atoi(w)
		height, eh := strconv.Atoi(h)
		if !ok || ew != nil || eh != nil || width < 1 || height < 1 || max(width, height) > 4096 {
			return nil, fmt.Errorf("invalid Gemini image size")
		}
		ratio := float64(width) / float64(height)
		distance := math.MaxFloat64
		for _, candidate := range ratios {
			w, h, _ := strings.Cut(candidate, ":")
			a, _ := strconv.Atoi(w)
			b, _ := strconv.Atoi(h)
			d := math.Abs(ratio/(float64(a)/float64(b)) - 1)
			if d < distance {
				distance = d
				config["aspectRatio"] = candidate
			}
		}
		if distance > 0.02 {
			return nil, fmt.Errorf("unsupported Gemini image aspect ratio")
		}
		config["imageSize"] = "1K"
		if max(width, height) > 2048 {
			config["imageSize"] = "4K"
		} else if max(width, height) > 1024 {
			config["imageSize"] = "2K"
		}
	}
	encoded, err := common.Marshal(config)
	if err != nil {
		return nil, err
	}
	c.Request.Header.Set("Content-Type", "application/json")
	return &dto.GeminiChatRequest{Contents: []dto.GeminiChatContent{{Role: "user", Parts: parts}}, GenerationConfig: dto.GeminiChatGenerationConfig{CandidateCount: common.GetPointer(1), ResponseModalities: []string{"IMAGE"}, ImageConfig: encoded}}, nil
}

// GeminiGenerativeImageHandler converts actual image parts to the Images API
// response expected by existing clients. Text-only and blocked results fail.
func GeminiGenerativeImageHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)
	body, err := io.ReadAll(io.LimitReader(resp.Body, (128<<20)+1))
	if err != nil || len(body) > 128<<20 {
		return nil, types.NewErrorWithStatusCode(errors.New("invalid Gemini image response"), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	var response dto.GeminiChatResponse
	if err := common.Unmarshal(body, &response); err != nil {
		return nil, types.NewErrorWithStatusCode(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	result := dto.ImageResponse{Created: common.GetTimestamp(), Data: []dto.ImageData{}}
	for _, candidate := range response.Candidates {
		for _, part := range candidate.Content.Parts {
			if part.Thought || part.InlineData == nil || part.InlineData.Data == "" || !slices.Contains([]string{"image/png", "image/jpeg", "image/webp"}, part.InlineData.MimeType) {
				continue
			}
			if _, err := base64.StdEncoding.DecodeString(part.InlineData.Data); err != nil {
				return nil, types.NewErrorWithStatusCode(errors.New("invalid Gemini image payload"), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
			}
			result.Data = append(result.Data, dto.ImageData{B64Json: part.InlineData.Data})
		}
	}
	if len(result.Data) == 0 || len(result.Data) > dto.MaxImageN {
		return nil, types.NewErrorWithStatusCode(errors.New("no valid images generated"), types.ErrorCodeBadResponseBody, http.StatusBadGateway, types.ErrOptionWithSkipRetry())
	}
	encoded, err := common.Marshal(result)
	if err != nil {
		return nil, types.NewError(err, types.ErrorCodeBadResponseBody, types.ErrOptionWithSkipRetry())
	}
	info.UpdateImageCount(int64(len(result.Data)))
	service.IOCopyBytesGracefully(c, resp, encoded)
	usage := &dto.Usage{}
	if response.GetUsageMetadata() != nil {
		usage.PromptTokens = response.UsageMetadata.PromptTokenCount
		usage.CompletionTokens = response.UsageMetadata.CandidatesTokenCount
		usage.TotalTokens = response.UsageMetadata.TotalTokenCount
	}
	return usage, nil
}
