package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestStudioLocalAssetsServeOnlyVersionedImageFiles(t *testing.T) {
	root := t.TempDir()
	t.Setenv("IMAGE_STUDIO_ASSET_DIR", root)
	dir := filepath.Join(root, "20261110", "pose", "originals")
	require.NoError(t, os.MkdirAll(dir, 0700))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "example.png"), []byte("original-bytes"), 0600))
	router := gin.New()
	router.GET("/assets/:version/:kind/:variant/:file", GetImageStudioAsset)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/assets/20261110/pose/originals/example.png", nil))
	require.Equal(t, 200, w.Code)
	require.Equal(t, "original-bytes", w.Body.String())
	require.Contains(t, w.Header().Get("Cache-Control"), "immutable")
	require.Equal(t, "image/png", w.Header().Get("Content-Type"))
	for _, path := range []string{"20261109/pose/originals/example.png", "20261110/private/originals/example.png", "20261110/pose/originals/example.webp", "20261110/pose/images/example.png", "20261110/pose/originals/.env", "20261110/pose/originals/missing.png"} {
		w = httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/assets/"+path, nil))
		require.Equal(t, 404, w.Code, path)
	}
}
