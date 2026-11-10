package controller

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

var studioAssetFile = regexp.MustCompile(`^[a-zA-Z0-9_-]+\.(png|webp)$`)

// The shipped catalog is the allowlist for pose media. Retired poses must not
// remain reachable through guessed or saved lineart/depth URLs.
var imageStudioPoseMedia = sync.OnceValue(func() map[string]bool {
	data, err := studioReferenceCatalog.ReadFile("resources/studio-local-catalog.json")
	if err != nil {
		return nil
	}
	var catalog struct {
		Items []struct {
			Kind     string `json:"kind"`
			Variants []struct {
				Original, Image, Thumbnail string
				Depth                      *struct{ Original, Image, Thumbnail string }
			} `json:"variants"`
		} `json:"items"`
	}
	if json.Unmarshal(data, &catalog) != nil {
		return nil
	}
	allowed := make(map[string]bool)
	add := func(path string) { allowed[strings.TrimPrefix(path, "/api/image-playground/assets/")] = true }
	for _, item := range catalog.Items {
		if item.Kind != "pose" {
			continue
		}
		for _, view := range item.Variants {
			add(view.Original)
			add(view.Image)
			add(view.Thumbnail)
			if view.Depth != nil {
				add(view.Depth.Original)
				add(view.Depth.Image)
				add(view.Depth.Thumbnail)
			}
		}
	}
	return allowed
})

// Built-in references are public static images. No user-uploaded files are served here.
func GetImageStudioAsset(c *gin.Context) {
	version, kind, variant, name := c.Param("version"), c.Param("kind"), c.Param("variant"), c.Param("file")
	if version != "20261110" || (kind != "pose" && kind != "costume" && kind != "character") || (variant != "originals" && variant != "images" && variant != "thumbnails") || !studioAssetFile.MatchString(name) || (variant == "originals") != strings.HasSuffix(name, ".png") {
		c.Status(http.StatusNotFound)
		return
	}
	if kind == "pose" && !imageStudioPoseMedia()[strings.Join([]string{version, kind, variant, name}, "/")] {
		c.Header("Cache-Control", "no-store")
		c.Status(http.StatusNotFound)
		return
	}
	root := os.Getenv("IMAGE_STUDIO_ASSET_DIR")
	if root == "" {
		root = "./image-studio-assets"
	}
	path := filepath.Join(root, version, kind, variant, name)
	file, err := os.Open(path)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || !stat.Mode().IsRegular() {
		c.Status(http.StatusNotFound)
		return
	}
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Header("X-Content-Type-Options", "nosniff")
	if variant == "originals" {
		c.Header("Content-Type", "image/png")
	} else {
		c.Header("Content-Type", "image/webp")
	}
	http.ServeContent(c.Writer, c.Request, name, stat.ModTime(), file)
}
