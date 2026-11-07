package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"github.com/stretchr/testify/require"
	"image"
	"image/color"
	"image/gif"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestStudioTaskRecoversMixedGIFResponseWithoutNewGeneration(t *testing.T) {
	var encoded bytes.Buffer
	palette := color.Palette{color.Black, color.White}
	first := image.NewPaletted(image.Rect(0, 0, 32, 16), palette)
	second := image.NewPaletted(first.Rect, palette)
	second.SetColorIndex(0, 0, 1)
	require.NoError(t, gif.EncodeAll(&encoded, &gif.GIF{Image: []*image.Paletted{first, second}, Delay: []int{10, 10}, LoopCount: 0}))
	body := fmt.Sprintf(`{"data":[{"b64_json":"%s","output_format":"gif"},{"b64_json":"%s","output_format":"png"}]}`, base64.StdEncoding.EncodeToString(encoded.Bytes()), base64.StdEncoding.EncodeToString(studioTestPNG(t)))
	calls := 0
	store := studioTestStore(t, func(_ context.Context, _ StudioTaskRequest, _ io.Reader, w http.ResponseWriter) error {
		calls++
		_, err := io.WriteString(w, body)
		return err
	})
	_, err := store.Submit(studioTestID, StudioTaskRequest{OwnerID: 1, Model: "gpt-image-2.6-basic", Group: ImageStudioGroup}, []byte(`{"parameters":{"format":"gif","count":1}}`), []byte(`{}`))
	require.NoError(t, err)
	store.runNext(context.Background())
	task, err := store.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "ready", task.Status)
	require.Len(t, task.Images, 2)
	require.Equal(t, "image/gif", task.Images[0].ContentType)
	require.Equal(t, "image/png", task.Images[1].ContentType)
	require.Equal(t, 1, calls)
}

func TestStudioRestartRecoversPreviouslyFailedMixedGIFWithoutRelay(t *testing.T) {
	var animated bytes.Buffer
	palette := color.Palette{color.Black, color.White}
	first := image.NewPaletted(image.Rect(0, 0, 32, 16), palette)
	second := image.NewPaletted(first.Rect, palette)
	require.NoError(t, gif.EncodeAll(&animated, &gif.GIF{Image: []*image.Paletted{first, second}, Delay: []int{10, 10}}))
	store := studioTestStore(t, nil)
	_, err := store.Submit(studioTestID, StudioTaskRequest{OwnerID: 1, Model: "gpt-image-2.6-basic", Group: ImageStudioGroup}, []byte(`{"parameters":{"format":"gif","count":1}}`), []byte(`{}`))
	require.NoError(t, err)
	e := store.entries[studioTestID]
	e.Task.Status = "failed"
	e.Task.Error = errStudioGIFNotAnimated.Error()
	e.Task.Images = []StudioTaskImage{{Index: 0, Width: 32, Height: 16, ContentType: "image/gif"}}
	require.NoError(t, store.save(e))
	body := fmt.Sprintf(`{"data":[{"b64_json":"%s"},{"b64_json":"%s"}]}`, base64.StdEncoding.EncodeToString(animated.Bytes()), base64.StdEncoding.EncodeToString(studioTestPNG(t)))
	require.NoError(t, os.WriteFile(filepath.Join(store.root, studioTestID, "response.json"), []byte(body), 0600))
	calls := 0
	reloaded, err := NewStudioTaskStore(store.root, func(context.Context, StudioTaskRequest, io.Reader, http.ResponseWriter) error { calls++; return nil })
	require.NoError(t, err)
	reloaded.runNext(context.Background())
	task, err := reloaded.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "ready", task.Status)
	require.Len(t, task.Images, 2)
	require.Zero(t, calls)
}
