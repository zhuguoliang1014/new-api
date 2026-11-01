package service

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestStudioMJCreativeControlsValidation(t *testing.T) {
	for _, body := range []string{`{}`, `{"raw":false,"tile":false,"seed":0,"stylize":0,"chaos":100,"weird":3000,"iw":0,"cref":"https://example.com/c.png","cw":0,"sref":"https://example.com/s.png","sw":1000,"dref":"https://example.com/d.png","dw":0}`} {
		var options StudioMJOptions
		require.NoError(t, common.UnmarshalJsonStr(body, &options))
		require.NoError(t, options.Validate())
	}
	for _, body := range []string{`{"seed":-1}`, `{"seed":4294967296}`, `{"stylize":1001}`, `{"chaos":101}`, `{"weird":3001}`, `{"iw":3.1}`, `{"dw":-1}`, `{"cref":"file:///etc/passwd"}`, `{"sref":"https://user:secret@example.com/image.png"}`, `{"dref":"invalid"}`, `{"cw":20}`, `{"sw":0}`, `{"dw":1}`} {
		t.Run(body, func(t *testing.T) {
			var options StudioMJOptions
			require.NoError(t, common.UnmarshalJsonStr(body, &options))
			require.Error(t, options.Validate())
		})
	}
}

func TestStudioSupportsAllBananaModels(t *testing.T) {
	for _, name := range []string{"gemini-nano-banana-2.1", "gemini-3-pro-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image", "gemini-3.1-flash-image-preview", "gemini-2.5-flash-image"} {
		profile, ok := GetImageStudioModelProfile(ImageStudioGroup, name)
		require.True(t, ok, name)
		require.Equal(t, 1, profile.MaxCount)
	}
}
