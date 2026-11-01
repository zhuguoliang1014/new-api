package controller

import (
	"bytes"
	"io"
	"mime"
	"mime/multipart"
	"net/textproto"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestStudioRelayFormPreservesReferenceBytesWithoutHistoryMetadata(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	require.NoError(t, writer.WriteField("studio_metadata", `{"private":"history"}`))
	require.NoError(t, writer.WriteField("prompt", "Draw a lake"))
	require.NoError(t, writer.WriteField("size", "8192x4608"))
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="image[]"; filename="reference.png"`)
	header.Set("Content-Type", "image/png")
	part, err := writer.CreatePart(header)
	require.NoError(t, err)
	original := []byte{0x89, 'P', 'N', 'G', 0, 255, 13, 10}
	_, err = part.Write(original)
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	form, err := multipart.NewReader(bytes.NewReader(body.Bytes()), writer.Boundary()).ReadForm(1)
	require.NoError(t, err)
	defer form.RemoveAll()
	encoded, contentType, count, err := encodeStudioRelayForm(form, writer.FormDataContentType())
	require.NoError(t, err)
	require.Equal(t, 1, count)
	_, params, err := mime.ParseMediaType(contentType)
	require.NoError(t, err)
	require.Equal(t, writer.Boundary(), params["boundary"])
	decoded, err := multipart.NewReader(bytes.NewReader(encoded), params["boundary"]).ReadForm(1 << 20)
	require.NoError(t, err)
	defer decoded.RemoveAll()
	require.NotContains(t, decoded.Value, "studio_metadata")
	require.Equal(t, []string{"Draw a lake"}, decoded.Value["prompt"])
	require.Equal(t, []string{"8192x4608"}, decoded.Value["size"])
	require.Equal(t, "image/png", decoded.File["image[]"][0].Header.Get("Content-Type"))
	file, err := decoded.File["image[]"][0].Open()
	require.NoError(t, err)
	defer file.Close()
	actual, err := io.ReadAll(file)
	require.NoError(t, err)
	require.Equal(t, original, actual)
	form.File["mask"] = form.File["image[]"]
	_, _, _, err = encodeStudioRelayForm(form, writer.FormDataContentType())
	require.Error(t, err)
}
