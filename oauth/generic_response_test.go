package oauth

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

const providerHTTPErrorKey = "{{provider}} login service returned an error (HTTP {{status}}). Sign-in through this provider is temporarily unavailable. Please restart sign-in later or use another sign-in method."
const providerResponseErrorKey = "{{provider}} login service returned an invalid response. Sign-in through this provider is temporarily unavailable. Please restart sign-in later or use another sign-in method."

func TestGenericOAuthProviderResponseErrors(t *testing.T) {
	for _, stage := range []string{"token", "profile"} {
		for _, tc := range []struct {
			name      string
			status    int
			body      string
			truncated bool
			key       string
		}{
			{"edge error page", 567, "<!doctype html><html>private upstream details;</html>", false, providerHTTPErrorKey},
			{"rate limited", 429, `{"error":"rate_limited"}`, false, providerHTTPErrorKey},
			{"server failure with success body", 503, `{"access_token":"secret-token","userid":123}`, false, providerHTTPErrorKey},
			{"html with success status", 200, "<html>private upstream details;</html>", false, providerResponseErrorKey},
			{"malformed json", 200, `{"access_token":"secret-token","userid":123`, false, providerResponseErrorKey},
			{"truncated response", 200, `{`, true, providerResponseErrorKey},
		} {
			t.Run(stage+"/"+tc.name, func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if tc.truncated {
						w.Header().Set("Content-Length", "1000")
					}
					w.WriteHeader(tc.status)
					_, _ = fmt.Fprint(w, tc.body)
				}))
				defer server.Close()
				provider := NewGenericOAuthProvider(&model.CustomOAuthProvider{Name: "妖火论坛", Slug: "yaohuo", TokenEndpoint: server.URL, UserInfoEndpoint: server.URL, UserIdField: "userid"})
				var err error
				if stage == "token" {
					_, err = provider.ExchangeToken(context.Background(), "test-code", nil)
				} else {
					_, err = provider.GetUserInfo(context.Background(), &OAuthToken{AccessToken: "test-token"})
				}
				var providerErr *OAuthError
				require.ErrorAs(t, err, &providerErr)
				require.Equal(t, tc.key, providerErr.Message.Key)
				require.Equal(t, "妖火论坛", providerErr.Message.Params["provider"])
				if tc.status != 200 {
					require.Equal(t, tc.status, providerErr.Message.Params["status"])
				}
				require.NotContains(t, providerErr.Message.Error(), "private upstream")
				require.NotContains(t, providerErr.Message.Error(), "secret-token")
			})
		}
	}
}

func TestGenericOAuthTokenResponseCompatibility(t *testing.T) {
	for _, body := range []string{`{"access_token":"test-token","token_type":"Bearer"}`, "access_token=test-token&token_type=Bearer"} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = fmt.Fprint(w, body) }))
			defer server.Close()
			provider := NewGenericOAuthProvider(&model.CustomOAuthProvider{TokenEndpoint: server.URL})
			token, err := provider.ExchangeToken(context.Background(), "test-code", nil)
			require.NoError(t, err)
			require.Equal(t, "test-token", token.AccessToken)
		})
	}
}

func TestGenericOAuthProviderConnectionFailure(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	server.Close()
	provider := NewGenericOAuthProvider(&model.CustomOAuthProvider{Name: "妖火论坛", TokenEndpoint: server.URL, UserInfoEndpoint: server.URL})
	_, tokenErr := provider.ExchangeToken(context.Background(), "test-code", nil)
	_, profileErr := provider.GetUserInfo(context.Background(), &OAuthToken{AccessToken: "test-token"})
	for _, err := range []error{tokenErr, profileErr} {
		var providerErr *OAuthError
		require.ErrorAs(t, err, &providerErr)
		require.Equal(t, msgConnectFailed, providerErr.Message.Key)
		require.Equal(t, "妖火论坛", providerErr.Message.Params["provider"])
	}
}

func TestGenericOAuthProviderLocalConfigurationError(t *testing.T) {
	provider := NewGenericOAuthProvider(&model.CustomOAuthProvider{TokenEndpoint: ":invalid", UserInfoEndpoint: ":invalid"})
	_, tokenErr := provider.ExchangeToken(context.Background(), "test-code", nil)
	_, profileErr := provider.GetUserInfo(context.Background(), &OAuthToken{AccessToken: "test-token"})
	for _, err := range []error{tokenErr, profileErr} {
		require.Error(t, err)
		var providerErr *OAuthError
		require.NotErrorAs(t, err, &providerErr)
	}
}

func TestGenericOAuthStructuredRejection(t *testing.T) {
	for _, body := range []string{`{"error":"invalid_grant","error_description":"private rejection details"}`, "error=invalid_grant&error_description=private+rejection+details"} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = fmt.Fprint(w, body) }))
			defer server.Close()
			provider := NewGenericOAuthProvider(&model.CustomOAuthProvider{Name: "妖火论坛", TokenEndpoint: server.URL})
			_, err := provider.ExchangeToken(context.Background(), "test-code", nil)
			var providerErr *OAuthError
			require.ErrorAs(t, err, &providerErr)
			require.Equal(t, msgTokenFailed, providerErr.Message.Key)
			require.NotContains(t, providerErr.Message.Error(), "private rejection")
		})
	}
}
