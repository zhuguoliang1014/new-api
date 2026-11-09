package controller

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestStudioReferenceCatalogKeepsShippedScenes(t *testing.T) {
	router := gin.New()
	router.GET("/catalog", GetImageStudioCatalog)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/catalog", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	var catalog struct {
		Version int `json:"version"`
		Assets  []struct {
			ID, Role, Src, Instruction string
			Views                      []struct{ ID, Src, Instruction string }
		} `json:"assets"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &catalog); err != nil {
		t.Fatal(err)
	}
	if catalog.Version != 1 || len(catalog.Assets) == 0 {
		t.Fatal("missing catalog")
	}
	ids := map[string]bool{}
	for _, a := range catalog.Assets {
		if ids[a.ID] || a.ID == "" || a.Instruction == "" {
			t.Fatalf("invalid asset %q", a.ID)
		}
		ids[a.ID] = true
		paths := []string{a.Src}
		seen := map[string]bool{}
		for _, v := range a.Views {
			if seen[v.Src] || v.Instruction == "" {
				t.Fatalf("view duplicates or lacks instructions: %s", a.ID)
			}
			seen[v.Src] = true
			paths = append(paths, v.Src)
		}
		for _, p := range paths {
			if !strings.HasPrefix(p, "/images/studio/") || strings.Contains(p, "..") {
				t.Fatalf("unsafe asset path %q", p)
			}
			if _, err := os.Stat(filepath.Join("..", "web", "public", p)); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestStudioReferenceCatalogPreservesCompletePinnedSource(t *testing.T) {
	source, err := studioReferenceCatalog.ReadFile("resources/studio-local-catalog.json")
	if err != nil {
		t.Fatal(err)
	}
	if got := fmt.Sprintf("%x", sha256.Sum256(source)); got != "8dc73e16a3198c70fa2787526a8ddc34f5f47c91751f2e441e7597ed47281cba" {
		t.Fatalf("source catalog changed: %s", got)
	}
	response, err := imageStudioCatalogResponse()
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Assets []struct {
			Role string `json:"role"`
		} `json:"assets"`
		ReferenceCatalog struct {
			Items []struct {
				ID, Kind string
				Variants []struct {
					ID, Original string
					Depth        *struct{ Original, Image, Thumbnail string }
				}
			} `json:"items"`
		} `json:"referenceCatalog"`
	}
	if err := json.Unmarshal(response, &catalog); err != nil {
		t.Fatal(err)
	}
	for _, asset := range catalog.Assets {
		if asset.Role != "scene" {
			t.Fatal("old generated sample remained in imported library")
		}
	}
	counts := map[string]int{}
	ids := map[string]bool{}
	poseViews := 0
	depthViews := 0
	for _, item := range catalog.ReferenceCatalog.Items {
		if ids[item.ID] {
			t.Fatalf("duplicate id %s", item.ID)
		}
		ids[item.ID] = true
		counts[item.Kind]++
		views := map[string]bool{}
		for _, view := range item.Variants {
			if views[view.Original] || view.Original == "" {
				t.Fatalf("missing or duplicated original for %s", item.ID)
			}
			views[view.Original] = true
			if item.Kind == "pose" {
				if view.Depth == nil || !strings.HasSuffix(view.Depth.Original, "-depth.png") || !strings.HasSuffix(view.Depth.Image, "-depth.webp") || !strings.Contains(view.Depth.Thumbnail, "/thumbnails/") {
					t.Fatalf("missing depth media for %s/%s", item.ID, view.ID)
				}
				depthViews++
			} else if view.Depth != nil {
				t.Fatalf("unexpected depth for %s", item.ID)
			}
		}
		if item.Kind == "pose" {
			poseViews += len(item.Variants)
		}
	}
	if counts["pose"] != 288 || counts["costume"] != 1407 || counts["character"] != 1499 || poseViews != 1439 || depthViews != 1439 {
		t.Fatalf("incomplete import: %v, %d pose views", counts, poseViews)
	}
}
