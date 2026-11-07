package service

import (
	"context"
	"encoding/base64"
	"fmt"
	"github.com/stretchr/testify/require"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const studioTestSVG = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><defs><linearGradient id="paint"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs><style>.shape{fill:url(#paint)}</style><path class="shape" d="M10 10h100v100H10z"/><text x="20" y="150">矢量猫</text></svg>`

func TestStudioSVGTaskKeepsVectorOriginalForPreviewAndDownload(t *testing.T) {
	for _, requested := range []string{"auto", "svg"} {
		t.Run(requested, func(t *testing.T) {
			store := studioTestStore(t, func(_ context.Context, _ StudioTaskRequest, _ io.Reader, w http.ResponseWriter) error {
				_, err := fmt.Fprintf(w, `{"data":[{"b64_json":"%s"}]}`, base64.StdEncoding.EncodeToString([]byte(studioTestSVG)))
				return err
			})
			_, err := store.Submit(studioTestID, StudioTaskRequest{OwnerID: 1, Group: ImageStudioGroup, Model: "gpt-image-2.6-flare-basic"}, []byte(fmt.Sprintf(`{"parameters":{"format":"%s"}}`, requested)), []byte(`{}`))
			require.NoError(t, err)
			store.runNext(context.Background())
			task, err := store.Get(1, studioTestID)
			require.NoError(t, err)
			require.Equal(t, "ready", task.Status)
			require.Equal(t, "image/svg+xml", task.Images[0].ContentType)
			require.Equal(t, 640, task.Images[0].Width)
			require.Equal(t, 480, task.Images[0].Height)
			reloaded, err := NewStudioTaskStore(store.root, store.relay)
			require.NoError(t, err)
			for _, thumbnail := range []bool{false, true} {
				f, _, err := reloaded.Image(1, studioTestID, 0, thumbnail)
				require.NoError(t, err)
				data, err := io.ReadAll(f)
				f.Close()
				require.NoError(t, err)
				require.Equal(t, studioTestSVG, string(data))
			}
		})
	}
}
func TestStudioSVGRejectsActiveExternalAndInvalidDocuments(t *testing.T) {
	for _, content := range []string{
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="https://example.com/a.png"/></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@import 'https://example.com/a.css';</style></svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect fill="url(https://example.com/a.svg)"/></svg>`,
		`<!DOCTYPE svg [<!ENTITY test SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">&test;</svg>`,
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 NaN 10"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg" width="100000" height="100000"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg"/>`,
		`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/><svg xmlns="http://www.w3.org/2000/svg"/>`,
		`<html><script>1</script></html>`,
	} {
		_, err := prepareStudioSVG(strings.NewReader(content))
		require.Error(t, err, content)
	}
}
func TestStudioSVGDimensionSources(t *testing.T) {
	for _, tc := range []struct {
		attrs string
		w, h  int
	}{
		{`width="640px" height="480px"`, 640, 480},
		{`width="100%" height="100%" viewBox="0 0 640 480"`, 640, 480},
		{`width="320" viewBox="0 0 640 480"`, 320, 240},
	} {
		info, err := prepareStudioSVG(strings.NewReader(`<svg xmlns="http://www.w3.org/2000/svg" ` + tc.attrs + `/>`))
		require.NoError(t, err)
		require.Equal(t, tc.w, info.Width)
		require.Equal(t, tc.h, info.Height)
	}
}
func TestStudioSVGFetchAndTaskOwnership(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/svg+xml")
		io.WriteString(w, studioTestSVG)
	}))
	defer server.Close()
	store := studioTestStore(t, func(_ context.Context, _ StudioTaskRequest, _ io.Reader, w http.ResponseWriter) error {
		_, err := fmt.Fprintf(w, `{"data":[{"url":"%s"}]}`, server.URL)
		return err
	})
	store.client = server.Client()
	studioTestSubmit(t, store, studioTestID)
	store.runNext(context.Background())
	task, err := store.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "ready", task.Status)
	_, _, err = store.Image(2, studioTestID, 0, false)
	require.ErrorIs(t, err, ErrStudioTaskNotFound)
}

func TestStudioSVGRequestRejectsRasterWithoutRegeneration(t *testing.T) {
	original := studioTestPNG(t)
	calls := 0
	store := studioTestStore(t, func(_ context.Context, _ StudioTaskRequest, _ io.Reader, w http.ResponseWriter) error {
		calls++
		_, err := fmt.Fprintf(w, `{"data":[{"b64_json":"%s"}]}`, base64.StdEncoding.EncodeToString(original))
		return err
	})
	_, err := store.Submit(studioTestID, StudioTaskRequest{OwnerID: 1, Model: "gpt-image-2.6-flare-basic", Group: ImageStudioGroup}, []byte(`{"parameters":{"format":"svg"}}`), []byte(`{}`))
	require.NoError(t, err)
	store.runNext(context.Background())
	task, err := store.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "failed", task.Status)
	require.Contains(t, task.Error, "SVG")
	store.runNext(context.Background())
	require.Equal(t, 1, calls)
}
