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
	require.NoError(t, os.WriteFile(filepath.Join(dir, "full_single_P001_front.png"), []byte("original-bytes"), 0600))
	router := gin.New()
	router.GET("/assets/:version/:kind/:variant/:file", GetImageStudioAsset)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest("GET", "/assets/20261110/pose/originals/full_single_P001_front.png", nil))
	require.Equal(t, 200, w.Code)
	require.Equal(t, "original-bytes", w.Body.String())
	require.Contains(t, w.Header().Get("Cache-Control"), "immutable")
	require.Equal(t, "image/png", w.Header().Get("Content-Type"))
	for _, path := range []string{"20261109/pose/originals/full_single_P001_front.png", "20261110/private/originals/full_single_P001_front.png", "20261110/pose/originals/full_single_P001_front.webp", "20261110/pose/images/full_single_P001_front.png", "20261110/pose/originals/.env", "20261110/pose/originals/missing.png"} {
		w = httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/assets/"+path, nil))
		require.Equal(t, 404, w.Code, path)
	}
}

func TestStudioRetiredPoseMediaAreNotServedEvenWhenFilesExist(t *testing.T) {
	root := t.TempDir()
	t.Setenv("IMAGE_STUDIO_ASSET_DIR", root)
	router := gin.New()
	router.GET("/assets/:version/:kind/:variant/:file", GetImageStudioAsset)
	names := []string{"full_sexy_P001_front", "pair60_P007_front", "upper80v2_P026_front", "upper80v2_P051_front", "full_single_P003_front"}
	for _, name := range names {
		for _, variant := range []string{"originals", "images", "thumbnails"} {
			for _, depth := range []string{"", "-depth"} {
				extension := ".webp"
				if variant == "originals" {
					extension = ".png"
				}
				relative := filepath.Join("20261110", "pose", variant, name+depth+extension)
				file := filepath.Join(root, relative)
				require.NoError(t, os.MkdirAll(filepath.Dir(file), 0700))
				require.NoError(t, os.WriteFile(file, []byte("retired"), 0600))
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest("GET", "/assets/"+relative, nil))
				require.Equal(t, 404, response.Code, relative)
				require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
				require.NotContains(t, response.Body.String(), "retired")
			}
		}
	}
	require.Len(t, imageStudioPoseMedia(), 360*6)
}
