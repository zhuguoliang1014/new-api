package controller

import (
	"embed"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

// studioReferenceCatalog is maintained by the server. Users cannot write to the
// built-in wardrobe or pose libraries, including their camera views.
//
//go:embed resources/studio-reference-catalog.json resources/studio-local-catalog.json
//go:embed resources/poseatlas/*.json
var studioReferenceCatalog embed.FS

// Scene references are bundled; reviewed library images use their upstream hosts.
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
	source, err := buildPoseAtlasCatalog()
	if err != nil {
		return nil, err
	}
	return json.Marshal(struct {
		Version          int               `json:"version"`
		Assets           []json.RawMessage `json:"assets"`
		ReferenceCatalog json.RawMessage   `json:"referenceCatalog"`
	}{1, scenes, source})
})

type poseAtlasCatalog struct {
	Poses []struct {
		ID       string                         `json:"id"`
		Variants []struct{ Thumb, Full string } `json:"variants"`
	} `json:"poses"`
	Costumes []struct{ ID, Image, Thumb string } `json:"costumes"`
	Faces    []struct {
		ID    string `json:"id"`
		Thumb string `json:"thumb_remote"`
		Full  string `json:"full_remote"`
	} `json:"images"`
}

const poseAtlasBase = "https://hruiccc.github.io/RuiC-PoseAtlas/"

var poseAtlasAssetPath = regexp.MustCompile(`^(?:img|thumbs|costume/img|costume/thumbs)/[a-zA-Z0-9_-]+\.(?:png|jpg|webp)$`)
var poseAtlasID = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

func poseAtlasURL(path string) (string, error) {
	if !poseAtlasAssetPath.MatchString(path) {
		return "", fmt.Errorf("invalid PoseAtlas asset path %q", path)
	}
	return poseAtlasBase + path, nil
}

// Preserve the previously reviewed catalog's IDs, labels and filters while
// changing only its image locations. Removed generated poses are not included
// in the reviewed catalog.
func buildPoseAtlasCatalog() ([]byte, error) {
	var source poseAtlasCatalog
	for _, path := range []string{"resources/poseatlas/poses.json", "resources/poseatlas/costumes.json", "resources/poseatlas/faces.json"} {
		data, err := studioReferenceCatalog.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(data, &source); err != nil {
			return nil, err
		}
	}
	poseViews := make(map[string]map[string][2]string)
	for _, pose := range source.Poses {
		views := make(map[string][2]string)
		for _, view := range pose.Variants {
			full, err := poseAtlasURL(view.Full)
			if err != nil {
				return nil, err
			}
			thumb, err := poseAtlasURL(view.Thumb)
			if err != nil {
				return nil, err
			}
			name := strings.TrimSuffix(filepath.Base(view.Full), filepath.Ext(view.Full))
			views[name] = [2]string{full, thumb}
		}
		poseViews[pose.ID] = views
	}
	costumes := make(map[string][2]string)
	for _, item := range source.Costumes {
		full, err := poseAtlasURL(item.Image)
		if err != nil {
			return nil, err
		}
		thumb, err := poseAtlasURL(item.Thumb)
		if err != nil {
			return nil, err
		}
		costumes[item.ID] = [2]string{full, thumb}
	}
	faces := make(map[string][2]string)
	for _, item := range source.Faces {
		if !poseAtlasID.MatchString(item.ID) || item.Full != "https://ai-portrait-gallery.pages.dev/img/full/"+item.ID+".png" || item.Thumb != "https://ai-portrait-gallery.pages.dev/img/thumb/"+item.ID+".webp" {
			return nil, fmt.Errorf("invalid portrait URLs for %s", item.ID)
		}
		faces["portrait-"+item.ID] = [2]string{item.Full, item.Thumb}
	}
	data, err := studioReferenceCatalog.ReadFile("resources/studio-local-catalog.json")
	if err != nil {
		return nil, err
	}
	var catalog struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.Unmarshal(data, &catalog); err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(catalog.Items))
	stats := map[string]int{"poseGroups": 0, "poseImages": 0, "costumes": 0, "characters": 0, "references": 0, "images": 0}
	for _, item := range catalog.Items {
		id, _ := item["id"].(string)
		kind, _ := item["kind"].(string)
		views, ok := item["variants"].([]any)
		if !ok {
			return nil, fmt.Errorf("missing variants for %s", id)
		}
		if kind == "pose" {
			upstream, found := poseViews[id]
			if !found {
				return nil, fmt.Errorf("missing upstream pose %s", id)
			}
			for _, raw := range views {
				view, ok := raw.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("invalid variant for %s", id)
				}
				viewID, _ := view["id"].(string)
				urls, found := upstream[viewID]
				if !found {
					return nil, fmt.Errorf("missing upstream variant %s", viewID)
				}
				view["original"], view["image"], view["thumbnail"] = urls[0], urls[1], urls[1]
				delete(view, "depth")
			}
			stats["poseGroups"]++
			stats["poseImages"] += len(views)
		} else {
			var urls [2]string
			var found bool
			switch kind {
			case "costume":
				urls, found = costumes[id]
				stats["costumes"]++
			case "character":
				urls, found = faces[id]
				stats["characters"]++
			default:
				return nil, fmt.Errorf("unexpected kind %s", kind)
			}
			if !found || len(views) != 1 {
				return nil, fmt.Errorf("missing upstream asset %s", id)
			}
			view, ok := views[0].(map[string]any)
			if !ok {
				return nil, fmt.Errorf("invalid variant for %s", id)
			}
			view["original"], view["image"], view["thumbnail"] = urls[0], urls[0], urls[1]
		}
		items = append(items, item)
		stats["images"] += len(views)
	}
	stats["references"] = len(items)
	return json.Marshal(struct {
		Items []map[string]any `json:"items"`
		Stats map[string]int   `json:"stats"`
	}{items, stats})
}

func GetImageStudioCatalog(c *gin.Context) {
	data, err := imageStudioCatalogResponse()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "reference catalog unavailable"})
		return
	}
	c.Header("Cache-Control", "private, max-age=60")
	c.Data(http.StatusOK, "application/json; charset=utf-8", data)
}
