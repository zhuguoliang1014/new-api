package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const studioMaxImageBytes int64 = 128 << 20
const studioMaxResponseBytes int64 = 700 << 20

type studioResponseWriter struct {
	file    *os.File
	header  http.Header
	status  int
	written int64
	err     error
}

func (w *studioResponseWriter) Header() http.Header { return w.header }
func (w *studioResponseWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
}
func (w *studioResponseWriter) Write(p []byte) (int, error) {
	if w.status == 0 {
		w.status = 200
	}
	if w.written+int64(len(p)) > studioMaxResponseBytes {
		w.err = errors.New("image response exceeds storage limit")
		return 0, w.err
	}
	n, err := w.file.Write(p)
	w.written += int64(n)
	w.err = err
	return n, err
}
func (w *studioResponseWriter) Flush() {}

func (s *StudioTaskStore) process(parent context.Context, e *studioTaskEntry, generate bool) (resultErr error) {
	defer func() {
		if recover() != nil {
			resultErr = errors.New("image task processing failed")
		}
	}()
	deadline := time.Now().Add(20 * time.Minute)
	if expiry := time.Unix(e.Task.ExpiresAt, 0); expiry.Before(deadline) {
		deadline = expiry
	}
	ctx, cancel := context.WithDeadline(parent, deadline)
	defer cancel()
	dir := filepath.Join(s.root, e.Task.ID)
	if generate {
		body, err := os.Open(filepath.Join(dir, "request"))
		if err != nil {
			return err
		}
		defer body.Close()
		response, err := os.OpenFile(filepath.Join(dir, "response.tmp"), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
		if err != nil {
			return err
		}
		writer := &studioResponseWriter{file: response, header: make(http.Header)}
		err = s.relay(ctx, e.Request, body, writer)
		if err == nil {
			err = writer.err
		}
		if err == nil {
			err = response.Sync()
		}
		closeErr := response.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			return err
		}
		if writer.status < 200 || writer.status >= 300 {
			raw, _ := os.ReadFile(filepath.Join(dir, "response.tmp"))
			var failure struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if common.Unmarshal(raw, &failure) == nil && failure.Error.Message != "" {
				s.mu.Lock()
				e.Task.Error = failure.Error.Message
				s.mu.Unlock()
			}
			os.Remove(filepath.Join(dir, "response.tmp"))
			os.Remove(filepath.Join(dir, "request"))
			return errors.New("image relay failed")
		}
		if err = os.Rename(filepath.Join(dir, "response.tmp"), filepath.Join(dir, "response.json")); err != nil {
			return err
		}
		s.mu.Lock()
		e.Task.Status = "downloading"
		err = s.save(e)
		s.mu.Unlock()
		if err != nil {
			return err
		}
		os.Remove(filepath.Join(dir, "request"))
	}
	// Serialize response parsing and image decoding to bound peak memory for 8K originals.
	s.artifactMu.Lock()
	defer s.artifactMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	response, err := os.Open(filepath.Join(dir, "response.json"))
	if err != nil {
		return err
	}
	var payload struct {
		Data []struct {
			URL    string `json:"url"`
			Base64 string `json:"b64_json"`
		} `json:"data"`
	}
	err = common.DecodeJson(io.LimitReader(response, studioMaxResponseBytes), &payload)
	response.Close()
	if err != nil {
		return err
	}
	if len(payload.Data) == 0 || len(payload.Data) > 4 {
		return errors.New("invalid image response")
	}
	s.mu.Lock()
	e.Task.DownloadedBytes = 0
	e.Task.TotalBytes = 0
	s.mu.Unlock()
	for i, item := range payload.Data {
		var source io.ReadCloser
		var length int64
		if item.Base64 != "" {
			source = io.NopCloser(base64.NewDecoder(base64.StdEncoding, strings.NewReader(item.Base64)))
			length = int64(base64.StdEncoding.DecodedLen(len(item.Base64)))
		} else {
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, item.URL, nil)
			if err != nil {
				return err
			}
			resp, err := s.client.Do(req)
			if err != nil {
				return err
			}
			if resp.StatusCode != http.StatusOK {
				resp.Body.Close()
				return errors.New("image host rejected download")
			}
			source = resp.Body
			length = resp.ContentLength
		}
		if length > studioMaxImageBytes {
			source.Close()
			return errors.New("image exceeds storage limit")
		}
		// Total describes the current image download, rather than guessing the size
		// of images whose response headers have not arrived yet.
		s.mu.Lock()
		e.Task.DownloadedBytes = 0
		e.Task.TotalBytes = max(0, length)
		e.Task.DownloadImageIndex = i + 1
		s.mu.Unlock()
		target := filepath.Join(dir, fmt.Sprintf("image-%d", i))
		file, err := os.OpenFile(target+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
		if err != nil {
			source.Close()
			return err
		}
		progress := &studioDownloadWriter{store: s, entry: e, writer: file}
		count, err := io.Copy(progress, io.LimitReader(source, studioMaxImageBytes+1))
		source.Close()
		if err == nil && count > studioMaxImageBytes {
			err = errors.New("image exceeds storage limit")
		}
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			os.Remove(target + ".tmp")
			return err
		}
		info, err := s.prepareImage(target+".tmp", target+".jpg")
		if err != nil {
			return err
		}
		info.Index = i
		info.Bytes = count
		if err = os.Rename(target+".tmp", target); err != nil {
			return err
		}
		s.mu.Lock()
		if i < len(e.Task.Images) {
			e.Task.Images[i] = info
		} else {
			e.Task.Images = append(e.Task.Images, info)
		}
		e.Task.DownloadedBytes = count
		e.Task.TotalBytes = count
		err = s.save(e)
		s.mu.Unlock()
		if err != nil {
			return err
		}
	}
	// The caller removes the source response only after persisting ready status.
	return nil
}

type studioDownloadWriter struct {
	store  *StudioTaskStore
	entry  *studioTaskEntry
	writer io.Writer
	last   time.Time
}

func (w *studioDownloadWriter) Write(p []byte) (int, error) {
	n, err := w.writer.Write(p)
	w.store.mu.Lock()
	w.entry.Task.DownloadedBytes += int64(n)
	if time.Since(w.last) > time.Second {
		_ = w.store.save(w.entry)
		w.last = time.Now()
	}
	w.store.mu.Unlock()
	return n, err
}
func (s *StudioTaskStore) prepareImage(source, target string) (StudioTaskImage, error) {
	s.thumbnailMu.Lock()
	defer s.thumbnailMu.Unlock()
	file, err := os.Open(source)
	if err != nil {
		return StudioTaskImage{}, err
	}
	defer file.Close()
	config, format, err := image.DecodeConfig(file)
	if err != nil {
		return StudioTaskImage{}, err
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > 8192 || config.Height > 8192 || int64(config.Width)*int64(config.Height) > 67108864 {
		return StudioTaskImage{}, errors.New("invalid image dimensions")
	}
	if format != "png" && format != "jpeg" && format != "webp" {
		return StudioTaskImage{}, errors.New("invalid image format")
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return StudioTaskImage{}, err
	}
	original, _, err := image.Decode(file)
	if err != nil {
		return StudioTaskImage{}, err
	}
	width, height := config.Width, config.Height
	if max(width, height) > 768 {
		width = max(1, width*768/max(config.Width, config.Height))
		height = max(1, height*768/max(config.Width, config.Height))
	}
	preview := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(preview, preview.Bounds(), image.White, image.Point{}, draw.Src)
	draw.ApproxBiLinear.Scale(preview, preview.Bounds(), original, original.Bounds(), draw.Over, nil)
	output, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return StudioTaskImage{}, err
	}
	err = jpeg.Encode(output, preview, &jpeg.Options{Quality: 82})
	closeErr := output.Close()
	if err == nil {
		err = closeErr
	}
	return StudioTaskImage{Width: config.Width, Height: config.Height, ContentType: "image/" + format}, err
}
