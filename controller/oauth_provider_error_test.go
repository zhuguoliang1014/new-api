package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/oauth"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestYaohuoCallbackShowsProviderFailure(t *testing.T) {
	setupSecurityEnrollmentTest(t)
	previousAddress := system_setting.ServerAddress
	system_setting.ServerAddress = "https://example.com"
	t.Cleanup(func() { system_setting.ServerAddress = previousAddress })
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(567)
		_, _ = w.Write([]byte("<!doctype html><html>private upstream details;</html>"))
	}))
	t.Cleanup(upstream.Close)
	provider := oauth.NewGenericOAuthProvider(&model.CustomOAuthProvider{
		Id: 42, Slug: "yaohuo", Name: "妖火论坛", Enabled: true,
		TokenEndpoint: upstream.URL, UserInfoEndpoint: upstream.URL,
	})
	require.NoError(t, oauth.RegisterCustom("yaohuo", provider))
	t.Cleanup(func() { oauth.Unregister("yaohuo") })
	router := gin.New()
	router.POST("/api/oauth/state", GenerateOAuthCode)
	router.GET("/api/oauth/:provider", HandleOAuth)
	state, cookie := startYaohuoOAuthLogin(t, router)
	request := httptest.NewRequest("GET", "/api/oauth/yaohuo?code=test-code&state="+state, nil)
	request.AddCookie(cookie)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, http.StatusOK, response.Code) // Existing OAuth business-error contract.
	var result struct {
		Success    bool           `json:"success"`
		Message    string         `json:"message"`
		MessageKey string         `json:"message_key"`
		Params     map[string]any `json:"message_params"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &result))
	require.False(t, result.Success)
	require.Contains(t, result.MessageKey, "{{provider}} login service returned an error (HTTP {{status}})")
	require.Equal(t, "妖火论坛", result.Params["provider"])
	require.Equal(t, float64(567), result.Params["status"])
	require.Contains(t, result.Message, "妖火论坛")
	require.NotContains(t, response.Body.String(), "AUTH_INTERNAL_ERROR")
	require.NotContains(t, response.Body.String(), "private upstream")
	// A failed exchange clears the browser binding; it must not issue a session.
	require.Len(t, response.Result().Cookies(), 1)
	require.Equal(t, cookie.Name, response.Result().Cookies()[0].Name)
	require.Equal(t, -1, response.Result().Cookies()[0].MaxAge)
}
