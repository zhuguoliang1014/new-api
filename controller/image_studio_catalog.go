package controller

import (
	"embed"
	"encoding/json"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
)

// studioReferenceCatalog is maintained by the server. Users cannot write to the
// built-in wardrobe or pose libraries, including their camera views. The asset paths are bundled web resources.
//
//go:embed resources/studio-reference-catalog.json resources/studio-local-catalog.json
var studioReferenceCatalog embed.FS

// The catalog contains only bundled scene references and locally hosted assets.
var imageStudioCatalogResponse = sync.OnceValues(func() ([]byte, error) {
	local, err := studioReferenceCatalog.ReadFile("resources/studio-reference-catalog.json")
	if err != nil {
		return nil, err
	}
	var localCatalog struct {
		Assets []json.RawMessage `json:"assets"`
	}
	if err := json.Unmarshal(local, &localCatalog); err != nil {
		return nil, err
	}
	scenes := make([]json.RawMessage, 0)
	for _, raw := range localCatalog.Assets {
		var asset struct {
			Role string `json:"role"`
		}
		if err := json.Unmarshal(raw, &asset); err != nil {
			return nil, err
		}
		if asset.Role == "scene" {
			scenes = append(scenes, raw)
		}
	}
	source, err := studioReferenceCatalog.ReadFile("resources/studio-local-catalog.json")
	if err != nil {
		return nil, err
	}
	return json.Marshal(struct {
		Version          int               `json:"version"`
		Assets           []json.RawMessage `json:"assets"`
		ReferenceCatalog json.RawMessage   `json:"referenceCatalog"`
	}{1, scenes, source})
})

func GetImageStudioCatalog(c *gin.Context) {
	data, err := imageStudioCatalogResponse()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "reference catalog unavailable"})
		return
	}
	c.Header("Cache-Control", "private, max-age=60")
	c.Data(http.StatusOK, "application/json; charset=utf-8", data)
}
