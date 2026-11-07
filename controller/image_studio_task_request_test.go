package controller

import (
	"bytes"
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestStudioRelayFormPreservesReferenceBytesWithoutHistoryMetadata(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("studio_metadata", `{"private":"history"}`))
	require.NoError(t, writer.WriteField("prompt", "Draw a lake"))
	require.NoError(t, writer.WriteField("size", "8192x4608"))
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="image[]"; filename="reference.png"`)
	header.Set("Content-Type", "image/png")
	part, err := writer.CreatePart(header)
	require.NoError(t, err)
	original := []byte{0x89, 'P', 'N', 'G', 0, 255, 13, 10}
	_, err = part.Write(original)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	form, err := multipart.NewReader(bytes.NewReader(body.Bytes()), writer.Boundary()).ReadForm(1)
	require.NoError(t, err)
	defer form.RemoveAll()
	encoded, contentType, count, err := encodeStudioRelayForm(form, writer.FormDataContentType())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	_, params, err := mime.ParseMediaType(contentType)
	require.NoError(t, err)
	require.Equal(t, writer.Boundary(), params["boundary"])
	decoded, err := multipart.NewReader(bytes.NewReader(encoded), params["boundary"]).ReadForm(1 << 20)
	require.NoError(t, err)
	defer decoded.RemoveAll()
	require.NotContains(t, decoded.Value, "studio_metadata")
	require.Equal(t, []string{"Draw a lake"}, decoded.Value["prompt"])
	require.Equal(t, []string{"8192x4608"}, decoded.Value["size"])
	require.Equal(t, "image/png", decoded.File["image[]"][0].Header.Get("Content-Type"))
	file, err := decoded.File["image[]"][0].Open()
	require.NoError(t, err)
	defer file.Close()
	actual, err := io.ReadAll(file)
	require.NoError(t, err)
	require.Equal(t, original, actual)
	form.File["mask"] = form.File["image[]"]
	_, _, _, err = encodeStudioRelayForm(form, writer.FormDataContentType())
	require.Error(t, err)
}

func TestStudioReferenceUploadRejectsMissingBytesBeforeEnqueue(t *testing.T) {
	previous := imageStudioTasks
	t.Cleanup(func() { imageStudioTasks = previous })
	store, err := service.NewStudioTaskStore(t.TempDir(), nil)
	require.NoError(t, err)
	imageStudioTasks = store
	router := gin.New()
	router.Use(middleware.BodyStorageCleanup(), func(c *gin.Context) { c.Set("id", 1507) })
	router.POST("/:kind", CreateImageStudioTask)
	metadata := `{"parameters":{"prompt":"A lake","model":"gpt-image-2.5-basic","group":"画图","size":"4096x4096","quality":"auto","format":"png","background":"auto","count":1},"referenceCount":1}`
	for _, tc := range []struct {
		name, filename, contentType, contents, message string
		status                                         int
	}{
		{"nameless file is not a multipart file", "", "image/png", "original", "Could not read the reference image. Select it again and retry.", 400},
		{"empty file", "photo.png", "image/png", "", "Could not read the reference image. Select it again and retry.", 400},
		{"unsupported format", "photo.heic", "image/heic", "original", "Upload PNG, JPEG or WebP images.", 400},
		{"fallback filename", "reference-1.png", "image/png", "original", "", 202},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var body bytes.Buffer
			writer := multipart.NewWriter(&body)
			for key, value := range map[string]string{"studio_metadata": metadata, "prompt": "A lake", "size": "4096x4096", "n": "1"} {
				require.NoError(t, writer.WriteField(key, value))
			}
			header := textproto.MIMEHeader{}
			header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "image[]", "filename": tc.filename}))
			header.Set("Content-Type", tc.contentType)
			part, err := writer.CreatePart(header)
			require.NoError(t, err)
			_, err = io.WriteString(part, tc.contents)
			require.NoError(t, err)
			require.NoError(t, writer.Close())
			req := httptest.NewRequest("POST", "/edits", &body)
			req.Header.Set("Content-Type", writer.FormDataContentType())
			req.Header.Set("X-Studio-Group", url.QueryEscape(service.ImageStudioGroup))
			req.Header.Set("X-Studio-Model", "gpt-image-2.5-basic")
			req.Header.Set("X-Studio-Task-ID", "mobile-reference-test-0001")
			before := len(store.List(1507))
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			require.Equal(t, tc.status, rec.Code, rec.Body.String())
			if tc.status == 400 {
				require.Contains(t, rec.Body.String(), tc.message)
				require.Len(t, store.List(1507), before)
			}
		})
	}
}

func TestStudioMJReferencesUseGenerationJSONAndPinHDTier(t *testing.T) {
	previous := imageStudioTasks
	defer func() { imageStudioTasks = previous }()
	captured := make(chan []byte, 1)
	requests := make(chan service.StudioTaskRequest, 1)
	store, err := service.NewStudioTaskStore(t.TempDir(), func(_ context.Context, req service.StudioTaskRequest, body io.Reader, writer http.ResponseWriter) error {
		raw, err := io.ReadAll(body)
		if err != nil {
			return err
		}
		captured <- raw
		requests <- req
		writer.WriteHeader(502)
		return nil
	})
	require.NoError(t, err)
	imageStudioTasks = store
	router := gin.New()
	router.Use(middleware.BodyStorageCleanup(), func(c *gin.Context) { c.Set("id", 1) })
	router.POST("/:kind", CreateImageStudioTask)
	metadata := map[string]any{"parameters": map[string]any{"prompt": "A cat", "model": "mj-v8.2", "group": service.ImageStudioGroup, "size": "16:9", "quality": "auto", "format": "png", "background": "auto", "count": 1}, "referenceCount": 5, "styleId": nil}
	references := []string{"data:image/png;base64,aW1hZ2U=", "data:image/png;base64,aW1hZ2U=", "data:image/png;base64,aW1hZ2U=", "data:image/png;base64,aW1hZ2U=", "data:image/png;base64,aW1hZ2U="}
	fields := map[string]any{"prompt": "A cat", "size": "16:9", "n": 1, "images": references, "hd": false, "studio_metadata": metadata}
	options := map[string]any{"raw": false, "tile": true, "seed": 0, "stylize": 0, "chaos": 30, "weird": 100, "negative_prompt": "text", "iw": 0, "cref": "https://example.com/c.png", "cw": 0, "sref": "https://example.com/s.png", "sw": 0, "dref": "https://example.com/d.png", "dw": 0}
	metadata["parameters"].(map[string]any)["mj"] = options
	for key, value := range options {
		fields[key] = value
	}

	post := func(id string) *httptest.ResponseRecorder {
		body, err := common.Marshal(fields)
		require.NoError(t, err)
		request := httptest.NewRequest("POST", "/edits", strings.NewReader(string(body)))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("X-Studio-Group", url.QueryEscape(service.ImageStudioGroup))
		request.Header.Set("X-Studio-Model", "mj-v8.2")
		request.Header.Set("X-Studio-Task-ID", id)
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, request)
		return recorder
	}
	response := post("studio-mj-json-test-0001")
	require.Equal(t, 202, response.Code, response.Body.String())
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	defer func() {
		cancel()
		<-done
	}()
	go func() {
		defer close(done)
		store.Run(ctx)
	}()
	select {
	case raw := <-captured:
		var actual map[string]any
		require.NoError(t, common.Unmarshal(raw, &actual))
		expected := map[string]any{"prompt": "A cat", "size": "16:9", "quality": "1", "hd": true, "n": 1, "response_format": "url", "images": references}
		for key, value := range options {
			expected[key] = value
		}
		encoded, err := common.Marshal(expected)
		require.NoError(t, err)
		require.JSONEq(t, string(encoded), string(raw))
		require.False(t, (<-requests).Edit)
	case <-time.After(5 * time.Second):
		t.Fatal("MJ task was not dispatched")
	}
	for _, images := range [][]string{{"file:///etc/passwd"}, {"data:image/png;base64,invalid"}} {
		fields["images"] = images
		require.Equal(t, 400, post("studio-mj-json-test-0002").Code)
	}
	fields["images"] = references
	fields["stylize"] = 1001
	require.Equal(t, 400, post("studio-mj-json-test-0003").Code)
	fields["stylize"] = 1 // Metadata still records zero: history must describe the actual request.
	require.Equal(t, 400, post("studio-mj-json-test-0004").Code)
	fields["stylize"] = 0
	fields["cref"] = "file:///etc/passwd"
	require.Equal(t, 400, post("studio-mj-json-test-0005").Code)
}

func TestStudioGIFOutputIsLimitedToGPTImage26(t *testing.T) {
	previous := imageStudioTasks
	t.Cleanup(func() { imageStudioTasks = previous })
	store, err := service.NewStudioTaskStore(t.TempDir(), nil)
	require.NoError(t, err)
	imageStudioTasks = store
	router := gin.New()
	router.Use(middleware.BodyStorageCleanup(), func(c *gin.Context) { c.Set("id", 1) })
	router.POST("/:kind", CreateImageStudioTask)
	for _, tc := range []struct {
		model, format string
		status        int
	}{
		{"gpt-image-2.6-basic", "gif", 202}, {"gpt-image-2.6-basic", "auto", 202}, {"gpt-image-2.6-basic", "png", 202}, {"gpt-image-2.6-basic", "jpeg", 400}, {"gpt-image-2-basic", "gif", 400}, {"gpt-image-2.5-flare-basic", "gif", 400}, {"gemini-3-pro-image", "gif", 400}, {"gpt-image-2.6-native", "gif", 400},
	} {
		t.Run(tc.model+tc.format, func(t *testing.T) {
			metadata := map[string]any{"parameters": map[string]any{"prompt": "A blinking cat", "model": tc.model, "group": service.ImageStudioGroup, "size": "1024x1024", "quality": "high", "format": tc.format, "background": "auto", "count": 1}, "referenceCount": 0}
			body, err := common.Marshal(map[string]any{"prompt": "A blinking cat", "n": 1, "size": "1024x1024", "quality": "high", "output_format": tc.format, "response_format": "b64_json", "studio_metadata": metadata})
			require.NoError(t, err)
			request := httptest.NewRequest("POST", "/generations", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Studio-Group", url.QueryEscape(service.ImageStudioGroup))
			request.Header.Set("X-Studio-Model", tc.model)
			request.Header.Set("X-Studio-Task-ID", "format-test-"+strings.ReplaceAll(tc.model, ".", "-")+"-"+tc.format)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, request)
			require.Equal(t, tc.status, rec.Code, rec.Body.String())
		})
	}
}
