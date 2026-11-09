package controller

import (
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
)

var studioAssetFile = regexp.MustCompile(`^[a-zA-Z0-9_-]+\.(png|webp)$`)

// Built-in references are public static images. No user-uploaded files are served here.
func GetImageStudioAsset(c *gin.Context) {
	version, kind, variant, name := c.Param("version"), c.Param("kind"), c.Param("variant"), c.Param("file")
	if version != "20261110" || (kind != "pose" && kind != "costume" && kind != "character") || (variant != "originals" && variant != "images" && variant != "thumbnails") || !studioAssetFile.MatchString(name) || (variant == "originals") != strings.HasSuffix(name, ".png") {
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
