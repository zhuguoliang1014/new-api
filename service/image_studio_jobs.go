package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/shirou/gopsutil/disk"
)

const ImageStudioRetention = 10 * time.Hour

// Five MJ references can occupy about 67 MiB after base64 encoding.
const ImageStudioMaxBody = 72 << 20

var studioTaskID = regexp.MustCompile(`^[a-zA-Z0-9_-]{20,64}$`)
var ErrStudioTaskNotFound = errors.New("image task not found")

type StudioTaskImage struct {
	Index       int    `json:"index"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	Bytes       int64  `json:"bytes"`
	ContentType string `json:"content_type"`
}
type StudioTask struct {
	ID                 string            `json:"id"`
	Status             string            `json:"status"`
	CreatedAt          int64             `json:"created_at"`
	ExpiresAt          int64             `json:"expires_at"`
	Metadata           json.RawMessage   `json:"metadata"`
	Images             []StudioTaskImage `json:"images"`
	DownloadImageIndex int               `json:"download_image_index"`
	DownloadedBytes    int64             `json:"downloaded_bytes"`
	TotalBytes         int64             `json:"total_bytes"`
	Error              string            `json:"error,omitempty"`
}
type StudioTaskRequest struct {
	OwnerID     int    `json:"owner_id"`
	ClientIP    string `json:"client_ip"`
	Group       string `json:"group"`
	Model       string `json:"model"`
	ContentType string `json:"content_type"`
	Edit        bool   `json:"edit"`
	Hash        string `json:"hash"`
}
type studioTaskEntry struct {
	Task    StudioTask        `json:"task"`
	Request StudioTaskRequest `json:"request"`
	busy    bool
}
type StudioTaskRelay func(context.Context, StudioTaskRequest, io.Reader, http.ResponseWriter) error

// One store owns one persistent directory. Deployments must route studio jobs
// to this instance; multiple processes must not share the directory.
type StudioTaskStore struct {
	mu          sync.Mutex
	root        string
	entries     map[string]*studioTaskEntry
	relay       StudioTaskRelay
	client      *http.Client
	thumbnailMu sync.Mutex
	artifactMu  sync.Mutex
}

func NewStudioTaskStore(root string, relay StudioTaskRelay) (*StudioTaskStore, error) {
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	protection, err := common.NewSSRFProtectionFromFetchSetting(false, false, false, nil, nil, []string{"80", "443"}, true)
	if err != nil {
		return nil, err
	}
	client := newProtectedFetchHTTPClientWithProxy(nil, nil, func() (*common.SSRFProtection, bool, error) { return protection, true, nil }, func(*http.Request) (*url.URL, error) { return nil, nil })
	client.Timeout = 8 * time.Minute
	s := &StudioTaskStore{root: root, entries: make(map[string]*studioTaskEntry), relay: relay, client: client}
	dirs, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	for _, dir := range dirs {
		if !dir.IsDir() || !studioTaskID.MatchString(dir.Name()) {
			continue
		}
		data, err := os.ReadFile(filepath.Join(root, dir.Name(), "manifest.json"))
		if errors.Is(err, os.ErrNotExist) {
			if err = os.RemoveAll(filepath.Join(root, dir.Name())); err != nil {
				return nil, err
			}
			continue
		}
		if err != nil {
			return nil, err
		}
		var entry studioTaskEntry
		if err = common.Unmarshal(data, &entry); err != nil {
			return nil, err
		}
		if entry.Task.ID != dir.Name() {
			return nil, errors.New("invalid image task manifest")
		}
		if time.Now().Unix() >= entry.Task.ExpiresAt {
			if err = os.RemoveAll(filepath.Join(root, dir.Name())); err != nil {
				return nil, err
			}
			continue
		}
		if entry.Task.Status == "generating" {
			// The provider may have billed before the process stopped. Never resubmit.
			entry.Task.Status = "failed"
			entry.Task.Error = "Image generation was interrupted by a server restart. Check usage before creating another image."
			if _, err := os.Stat(filepath.Join(root, dir.Name(), "response.json")); err == nil {
				entry.Task.Status = "downloading"
				entry.Task.Error = ""
			}
			if err = s.save(&entry); err != nil {
				return nil, err
			}
		}
		s.entries[entry.Task.ID] = &entry
	}
	return s, nil
}

func (s *StudioTaskStore) save(e *studioTaskEntry) error {
	data, err := common.Marshal(e)
	if err != nil {
		return err
	}
	path := filepath.Join(s.root, e.Task.ID, "manifest.json")
	f, err := os.OpenFile(path+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(path+".tmp", path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}

func (s *StudioTaskStore) Submit(id string, req StudioTaskRequest, metadata json.RawMessage, body []byte) (StudioTask, error) {
	if !studioTaskID.MatchString(id) || req.OwnerID <= 0 || len(body) > ImageStudioMaxBody {
		return StudioTask{}, errors.New("invalid image task request")
	}
	hash := sha256.New()
	hash.Write(body)
	hash.Write(metadata)
	identity, _ := common.Marshal(req)
	hash.Write(identity)
	req.Hash = hex.EncodeToString(hash.Sum(nil))
	s.mu.Lock()
	defer s.mu.Unlock()
	if e, ok := s.entries[id]; ok {
		if e.Request.OwnerID != req.OwnerID || e.Request.Hash != req.Hash {
			return StudioTask{}, errors.New("image task ID already exists")
		}
		return cloneStudioTask(e.Task), nil
	}
	active, total := 0, 0
	for _, e := range s.entries {
		if e.Task.Status == "queued" || e.Task.Status == "generating" || e.Task.Status == "downloading" {
			total++
			if e.Request.OwnerID == req.OwnerID {
				active++
			}
		}
	}
	if active >= 4 || total >= 128 {
		return StudioTask{}, errors.New("image task queue is full")
	}
	usage, err := disk.Usage(s.root)
	if err != nil {
		return StudioTask{}, err
	}
	reserve := uint64(total+1)*uint64(studioMaxResponseBytes+4*studioMaxImageBytes+ImageStudioMaxBody) + (512 << 20)
	if usage.Free < reserve {
		return StudioTask{}, errors.New("image task storage is full")
	}
	now := time.Now()
	e := &studioTaskEntry{Request: req, Task: StudioTask{ID: id, Status: "queued", CreatedAt: now.UnixMilli(), ExpiresAt: now.Add(ImageStudioRetention).Unix(), Metadata: slices.Clone(metadata), Images: []StudioTaskImage{}}}
	dir := filepath.Join(s.root, id)
	if err := os.Mkdir(dir, 0700); err != nil {
		return StudioTask{}, err
	}
	requestFile, err := os.OpenFile(filepath.Join(dir, "request"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err == nil {
		_, err = requestFile.Write(body)
		if err == nil {
			err = requestFile.Sync()
		}
		closeErr := requestFile.Close()
		if err == nil {
			err = closeErr
		}
	}
	if err != nil {
		os.RemoveAll(dir)
		return StudioTask{}, err
	}
	if err := s.save(e); err != nil {
		os.RemoveAll(dir)
		return StudioTask{}, err
	}
	s.entries[id] = e
	return cloneStudioTask(e.Task), nil
}
func cloneStudioTask(task StudioTask) StudioTask {
	task.Images = slices.Clone(task.Images)
	task.Metadata = slices.Clone(task.Metadata)
	return task
}
func (s *StudioTaskStore) Get(owner int, id string) (StudioTask, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[id]
	if !ok || e.Request.OwnerID != owner || time.Now().Unix() >= e.Task.ExpiresAt {
		return StudioTask{}, ErrStudioTaskNotFound
	}
	return cloneStudioTask(e.Task), nil
}
func (s *StudioTaskStore) List(owner int) []StudioTask {
	s.mu.Lock()
	defer s.mu.Unlock()
	tasks := []StudioTask{}
	for _, e := range s.entries {
		if e.Request.OwnerID == owner && time.Now().Unix() < e.Task.ExpiresAt {
			tasks = append(tasks, cloneStudioTask(e.Task))
		}
	}
	slices.SortFunc(tasks, func(a, b StudioTask) int {
		if a.CreatedAt > b.CreatedAt {
			return -1
		}
		if a.CreatedAt < b.CreatedAt {
			return 1
		}
		return 0
	})
	visible := make([]StudioTask, 0, len(tasks))
	completed := 0
	for _, task := range tasks {
		if task.Status == "ready" || task.Status == "failed" || task.Status == "download_failed" {
			completed++
			if completed > 30 {
				continue
			}
		}
		visible = append(visible, task)
	}
	return visible
}
func (s *StudioTaskStore) Delete(owner int, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[id]
	if !ok || e.Request.OwnerID != owner {
		return ErrStudioTaskNotFound
	}
	if e.busy || e.Task.Status == "queued" || e.Task.Status == "downloading" {
		return errors.New("image task is still running")
	}
	if err := os.RemoveAll(filepath.Join(s.root, id)); err != nil {
		return err
	}
	delete(s.entries, id)
	return nil
}
func (s *StudioTaskStore) RetryDownload(owner int, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[id]
	if !ok || e.Request.OwnerID != owner || time.Now().Unix() >= e.Task.ExpiresAt {
		return ErrStudioTaskNotFound
	}
	if e.Task.Status != "download_failed" || e.busy {
		return errors.New("image task download cannot be retried")
	}
	e.Task.Status = "downloading"
	e.Task.Error = ""
	return s.save(e)
}
func (s *StudioTaskStore) Image(owner int, id string, index int, thumbnail bool) (*os.File, StudioTaskImage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e, ok := s.entries[id]
	if !ok || e.Request.OwnerID != owner || time.Now().Unix() >= e.Task.ExpiresAt || index < 0 || index >= len(e.Task.Images) {
		return nil, StudioTaskImage{}, ErrStudioTaskNotFound
	}
	name := fmt.Sprintf("image-%d", index)
	if thumbnail {
		name += ".jpg"
	}
	f, err := os.Open(filepath.Join(s.root, id, name))
	return f, e.Task.Images[index], err
}
func (s *StudioTaskStore) Run(ctx context.Context) {
	var workers sync.WaitGroup
	workers.Go(func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.mu.Lock()
				for id, e := range s.entries {
					if !e.busy && time.Now().Unix() >= e.Task.ExpiresAt {
						if os.RemoveAll(filepath.Join(s.root, id)) == nil {
							delete(s.entries, id)
						}
					}
				}
				s.mu.Unlock()
			}
		}
	})
	for range 4 {
		workers.Go(func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					s.runNext(ctx)
				}
			}
		})
	}
	workers.Wait()
}
func (s *StudioTaskStore) runNext(ctx context.Context) {
	s.mu.Lock()
	var selected *studioTaskEntry
	for id, e := range s.entries {
		if !e.busy && time.Now().Unix() >= e.Task.ExpiresAt {
			if os.RemoveAll(filepath.Join(s.root, id)) == nil {
				delete(s.entries, id)
			}
			continue
		}
		if !e.busy && (e.Task.Status == "queued" || e.Task.Status == "downloading") && (selected == nil || e.Task.CreatedAt < selected.Task.CreatedAt) {
			selected = e
		}
	}
	if selected == nil {
		s.mu.Unlock()
		return
	}
	selected.busy = true
	generate := selected.Task.Status == "queued"
	if generate {
		selected.Task.Status = "generating"
	}
	err := s.save(selected)
	s.mu.Unlock()
	if err == nil {
		err = s.process(ctx, selected, generate)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	selected.busy = false
	if err != nil {
		if selected.Task.Status == "downloading" {
			selected.Task.Status = "download_failed"
			selected.Task.Error = "Could not download the generated image. Retry the download without generating again."
		} else {
			selected.Task.Status = "failed"
			if selected.Task.Error == "" {
				selected.Task.Error = "Image generation failed."
			}
		}
	} else {
		selected.Task.Status = "ready"
	}
	if err := s.save(selected); err != nil {
		common.SysLog("failed to persist image studio task result")
	} else if selected.Task.Status == "ready" {
		_ = os.Remove(filepath.Join(s.root, selected.Task.ID, "response.json"))
	}
	if time.Now().Unix() >= selected.Task.ExpiresAt {
		if os.RemoveAll(filepath.Join(s.root, selected.Task.ID)) == nil {
			delete(s.entries, selected.Task.ID)
		}
	}
}
