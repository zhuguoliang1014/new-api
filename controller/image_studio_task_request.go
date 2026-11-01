package controller

import (
	"bytes"
	"errors"
	"io"
	"maps"
	"mime"
	"mime/multipart"
	"slices"
)

// Keep studio history metadata on this server. Preserve uploaded image bytes
// and their MIME headers when rebuilding the relay's multipart request.
func encodeStudioRelayForm(form *multipart.Form, contentType string) ([]byte, string, int, error) {
	_, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		return nil, "", 0, err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err = writer.SetBoundary(params["boundary"]); err != nil {
		return nil, "", 0, err
	}
	for _, key := range slices.Sorted(maps.Keys(form.Value)) {
		if key == "studio_metadata" {
			continue
		}
		for _, value := range form.Value[key] {
			if err = writer.WriteField(key, value); err != nil {
				return nil, "", 0, err
			}
		}
	}
	count := 0
	for _, key := range slices.Sorted(maps.Keys(form.File)) {
		if key != "image" && key != "image[]" {
			return nil, "", 0, errors.New("invalid reference image field")
		}
		for _, header := range form.File[key] {
			count++
			if count > 4 || header.Size <= 0 || header.Size > 10<<20 || !slices.Contains([]string{"image/png", "image/jpeg", "image/webp"}, header.Header.Get("Content-Type")) {
				return nil, "", 0, errors.New("invalid reference image")
			}
			file, err := header.Open()
			if err != nil {
				return nil, "", 0, err
			}
			part, err := writer.CreatePart(header.Header)
			if err == nil {
				_, err = io.Copy(part, file)
			}
			file.Close()
			if err != nil {
				return nil, "", 0, err
			}
		}
	}
	if count == 0 {
		return nil, "", 0, errors.New("reference image is required")
	}
	if err = writer.Close(); err != nil {
		return nil, "", 0, err
	}
	return body.Bytes(), writer.FormDataContentType(), count, nil
}
