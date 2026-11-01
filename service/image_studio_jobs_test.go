package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

const studioTestID = "studio-task-example-0001"

func studioTestPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 32, 16))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var b bytes.Buffer
	require.NoError(t, png.Encode(&b, img))
	return b.Bytes()
}
func studioTestStore(t *testing.T, relay StudioTaskRelay) *StudioTaskStore {
	t.Helper()
	store, err := NewStudioTaskStore(t.TempDir(), relay)
	require.NoError(t, err)
	return store
}
func studioTestSubmit(t *testing.T, s *StudioTaskStore, id string) StudioTask {
	t.Helper()
	task, err := s.Submit(id, StudioTaskRequest{OwnerID: 1, Group: "test", Model: "gpt-image-2"}, []byte(`{"parameters":{"prompt":"test","count":1}}`), []byte(`{"prompt":"test"}`))
	require.NoError(t, err)
	return task
}
func TestStudioTaskPersistsAndReturnsOriginalBytes(t *testing.T) {
	original := studioTestPNG(t)
	calls := 0
	store := studioTestStore(t, func(_ context.Context, _ StudioTaskRequest, _ io.Reader, w http.ResponseWriter) error {
		calls++
		_, err := fmt.Fprintf(w, `{"data":[{"b64_json":"%s"}]}`, base64.StdEncoding.EncodeToString(original))
		return err
	})
	studioTestSubmit(t, store, studioTestID)
	store.runNext(context.Background())
	task, err := store.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "ready", task.Status)
	require.Equal(t, 32, task.Images[0].Width)
	require.Equal(t, 16, task.Images[0].Height)
	file, _, err := store.Image(1, studioTestID, 0, false)
	require.NoError(t, err)
	data, err := io.ReadAll(file)
	file.Close()
	require.NoError(t, err)
	require.Equal(t, original, data)
	reloaded, err := NewStudioTaskStore(store.root, store.relay)
	require.NoError(t, err)
	reloaded.runNext(context.Background())
	require.Equal(t, 1, calls)
	task, err = reloaded.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "ready", task.Status)
}
func TestStudioTaskSameIDDoesNotGenerateTwice(t *testing.T) {
	store := studioTestStore(t, nil)
	first := studioTestSubmit(t, store, studioTestID)
	second := studioTestSubmit(t, store, studioTestID)
	require.Equal(t, first, second)
	require.Len(t, store.List(1), 1)
	_, err := store.Submit(studioTestID, StudioTaskRequest{OwnerID: 1}, []byte(`{}`), []byte(`different`))
	require.Error(t, err)
}
func TestStudioTaskOwnerCannotAccessAnotherOwnersArtifacts(t *testing.T) {
	store := studioTestStore(t, nil)
	studioTestSubmit(t, store, studioTestID)
	_, err := store.Get(2, studioTestID)
	require.ErrorIs(t, err, ErrStudioTaskNotFound)
	require.Empty(t, store.List(2))
	_, _, err = store.Image(2, studioTestID, 0, false)
	require.ErrorIs(t, err, ErrStudioTaskNotFound)
	require.ErrorIs(t, store.Delete(2, studioTestID), ErrStudioTaskNotFound)
	require.ErrorIs(t, store.RetryDownload(2, studioTestID), ErrStudioTaskNotFound)
}
func TestStudioTaskExpiryDeniesReadsAndRemovesFiles(t *testing.T) {
	store := studioTestStore(t, nil)
	studioTestSubmit(t, store, studioTestID)
	store.entries[studioTestID].Task.ExpiresAt = time.Now().Add(-time.Second).Unix()
	_, err := store.Get(1, studioTestID)
	require.ErrorIs(t, err, ErrStudioTaskNotFound)
	require.Empty(t, store.List(1))
	store.runNext(context.Background())
	_, err = os.Stat(filepath.Join(store.root, studioTestID))
	require.True(t, os.IsNotExist(err))
}
func TestStudioTaskRestartNeverReplaysAnUncertainGeneration(t *testing.T) {
	calls := 0
	store := studioTestStore(t, func(context.Context, StudioTaskRequest, io.Reader, http.ResponseWriter) error { calls++; return nil })
	studioTestSubmit(t, store, studioTestID)
	e := store.entries[studioTestID]
	e.Task.Status = "generating"
	require.NoError(t, store.save(e))
	reloaded, err := NewStudioTaskStore(store.root, store.relay)
	require.NoError(t, err)
	reloaded.runNext(context.Background())
	require.Zero(t, calls)
	task, err := reloaded.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "failed", task.Status)
	require.Contains(t, task.Error, "restart")
}
func TestStudioTaskQueuedRequestResumesAfterRestart(t *testing.T) {
	original := studioTestPNG(t)
	calls := 0
	store := studioTestStore(t, func(_ context.Context, _ StudioTaskRequest, r io.Reader, w http.ResponseWriter) error {
		calls++
		data, err := io.ReadAll(r)
		require.NoError(t, err)
		require.JSONEq(t, `{"prompt":"test"}`, string(data))
		_, err = fmt.Fprintf(w, `{"data":[{"b64_json":"%s"}]}`, base64.StdEncoding.EncodeToString(original))
		return err
	})
	studioTestSubmit(t, store, studioTestID)
	reloaded, err := NewStudioTaskStore(store.root, store.relay)
	require.NoError(t, err)
	reloaded.runNext(context.Background())
	require.Equal(t, 1, calls)
	task, err := reloaded.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "ready", task.Status)
}
func TestStudioTaskDownloadRetryDoesNotRepeatGeneration(t *testing.T) {
	original := studioTestPNG(t)
	var fail atomic.Bool
	fail.Store(true)
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Empty(t, r.Header.Get("Authorization"))
		require.Empty(t, r.Header.Get("Cookie"))
		if fail.Load() {
			w.WriteHeader(503)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(original)
	}))
	defer host.Close()
	calls := 0
	store := studioTestStore(t, func(_ context.Context, _ StudioTaskRequest, _ io.Reader, w http.ResponseWriter) error {
		calls++
		data, _ := common.Marshal(map[string]any{"data": []any{map[string]string{"url": host.URL}}})
		_, err := w.Write(data)
		return err
	})
	store.client = host.Client()
	studioTestSubmit(t, store, studioTestID)
	store.runNext(context.Background())
	task, err := store.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "download_failed", task.Status)
	fail.Store(false)
	require.NoError(t, store.RetryDownload(1, studioTestID))
	store.runNext(context.Background())
	require.Equal(t, 1, calls)
	task, err = store.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "ready", task.Status)
	require.Equal(t, int64(len(original)), task.DownloadedBytes)
}
func TestStudioTaskFetchBlocksPrivateNetworks(t *testing.T) {
	var requests atomic.Int32
	host := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1) }))
	defer host.Close()
	store := studioTestStore(t, func(_ context.Context, _ StudioTaskRequest, _ io.Reader, w http.ResponseWriter) error {
		_, err := fmt.Fprintf(w, `{"data":[{"url":%q}]}`, host.URL)
		return err
	})
	studioTestSubmit(t, store, studioTestID)
	store.runNext(context.Background())
	require.Zero(t, requests.Load())
	task, err := store.Get(1, studioTestID)
	require.NoError(t, err)
	require.Equal(t, "download_failed", task.Status)
}
func TestStudioTaskLimitsFourActiveJobsPerOwner(t *testing.T) {
	store := studioTestStore(t, nil)
	for i := range 4 {
		studioTestSubmit(t, store, fmt.Sprintf("studio-task-example-%04d", i))
	}
	_, err := store.Submit("studio-task-example-0005", StudioTaskRequest{OwnerID: 1}, []byte(`{}`), []byte(`{}`))
	require.ErrorContains(t, err, "queue is full")
}
func TestStudioTaskRejectsPathTraversal(t *testing.T) {
	store := studioTestStore(t, nil)
	for _, id := range []string{"../../outside", strings.Repeat("a", 65), "short"} {
		_, err := store.Submit(id, StudioTaskRequest{OwnerID: 1}, []byte(`{}`), []byte(`{}`))
		require.Error(t, err)
	}
}
