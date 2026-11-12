package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/alicebob/miniredis/v2"
	"github.com/go-redis/redis/v8"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type ipLocationRoundTripper func(*http.Request) (*http.Response, error)

func (f ipLocationRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func setupIPLocationTest(t *testing.T, transport ipLocationRoundTripper) *miniredis.Miniredis {
	t.Helper()
	oldRedis, oldEnabled, oldHTTP := common.RDB, common.RedisEnabled, ipLocationHTTPClient
	server := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: server.Addr(), MaxRetries: -1})
	common.RDB, common.RedisEnabled = client, true
	ipLocationHTTPClient = &http.Client{Transport: transport, Timeout: time.Second}
	t.Cleanup(func() {
		common.RDB, common.RedisEnabled, ipLocationHTTPClient = oldRedis, oldEnabled, oldHTTP
		_ = client.Close()
	})
	return server
}

func ipLocationResponse(body string, status int) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

const validIPLocationResponse = `{"ret":200,"data":{"ip":"8.8.8.8","country":"美国","country_code":"us","prov":"加利福尼亚","city":"山景城","isp":"Google"}}`

func TestIPLocationCacheMissDoesNotQueryAndExplicitLookupIsCached(t *testing.T) {
	var calls atomic.Int32
	server := setupIPLocationTest(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		assert.Equal(t, "https://ip9.com.cn/get?ip=8.8.8.8", r.URL.String())
		return ipLocationResponse(validIPLocationResponse, http.StatusOK), nil
	})
	ctx := context.Background()
	cached, err := GetCachedIPLocation(ctx, "8.8.8.8")
	require.NoError(t, err)
	require.Nil(t, cached)
	require.Zero(t, calls.Load())
	location, err := QueryIPLocation(ctx, "8.8.8.8")
	require.NoError(t, err)
	require.Equal(t, "山景城", location.City)
	require.Equal(t, "加利福尼亚", location.Region)
	require.Equal(t, "US", location.CountryCode)
	require.Equal(t, "Google", location.Network)
	require.Equal(t, ipLocationCacheTTL, server.TTL("ip-location:ip9:v1:8.8.8.8"))
	cached, err = QueryIPLocation(ctx, "8.8.8.8")
	require.NoError(t, err)
	require.Equal(t, location, cached)
	require.EqualValues(t, 1, calls.Load())
	server.FastForward(ipLocationCacheTTL)
	cached, err = GetCachedIPLocation(ctx, "8.8.8.8")
	require.NoError(t, err)
	require.Nil(t, cached)
}

func TestIPLocationRejectsNonPublicAddresses(t *testing.T) {
	setupIPLocationTest(t, func(*http.Request) (*http.Response, error) {
		t.Error("non-public address contacted external provider")
		return nil, fmt.Errorf("unexpected lookup")
	})
	for _, ip := range []string{"127.0.0.1", "10.0.0.1", "192.168.1.1", "100.64.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "::1", "fc00::1", "fe80::1", "2001:db8::1", "::ffff:127.0.0.1", "invalid"} {
		t.Run(ip, func(t *testing.T) {
			_, err := QueryIPLocation(context.Background(), ip)
			require.Error(t, err)
		})
	}
	for _, ip := range []string{"8.8.8.8", "111.58.230.113", "2606:4700:4700::1111"} {
		require.True(t, CanQueryIPLocation(ip))
	}
	ip, err := NormalizeLocationIP("::ffff:8.8.8.8")
	require.NoError(t, err)
	require.Equal(t, "8.8.8.8", ip)
	_, err = NormalizeLocationIP("fe80::1%en0")
	require.Error(t, err)
}

func TestIPLocationProviderFailuresNeverCacheFalseResults(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		status     int
	}{
		{"rate-limit", `{"error":"rate limited"}`, 429},
		{"html", `<html>unavailable</html>`, 200},
		{"wrong-ip", `{"ret":200,"data":{"ip":"1.1.1.1","country":"美国"}}`, 200},
		{"empty", `{"ret":200,"data":{"ip":"8.8.8.8"}}`, 200},
		{"business-error", `{"ret":429,"msg":"rate limited","data":{"ip":"8.8.8.8","country":"美国"}}`, 200},
		{"missing-status", `{"data":{"ip":"8.8.8.8","country":"美国"}}`, 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := setupIPLocationTest(t, func(*http.Request) (*http.Response, error) {
				calls.Add(1)
				return ipLocationResponse(tc.body, tc.status), nil
			})
			_, err := QueryIPLocation(context.Background(), "8.8.8.8")
			require.Error(t, err)
			require.False(t, server.Exists("ip-location:ip9:v1:8.8.8.8"))
			_, err = QueryIPLocation(context.Background(), "8.8.8.8")
			require.Error(t, err)
			require.EqualValues(t, 1, calls.Load(), "failure cooldown must suppress repeated upstream calls")
		})
	}
}

func TestIPLocationIP9IgnoresLegacyProviderCache(t *testing.T) {
	var calls atomic.Int32
	server := setupIPLocationTest(t, func(r *http.Request) (*http.Response, error) {
		calls.Add(1)
		assert.Equal(t, "111.58.230.113", r.URL.Query().Get("ip"))
		return ipLocationResponse(`{"ret":200,"data":{"ip":"111.58.230.113","country":"中国","country_code":"cn","prov":"广西","city":"南宁","isp":"中国移动"}}`, 200), nil
	})
	oldLocation := `{"ip":"111.58.230.113","country":"China","country_code":"CN","region":"Shanghai","city":"Shanghai","network":"China Mobile"}`
	server.Set("ip-location:v1:111.58.230.113", oldLocation)
	server.Set("ip-location:query:v1:111.58.230.113", "1")
	cached, err := GetCachedIPLocation(context.Background(), "111.58.230.113")
	require.NoError(t, err)
	require.Nil(t, cached, "IPQuery cache must not appear as IP9 data")
	location, err := QueryIPLocation(context.Background(), "111.58.230.113")
	require.NoError(t, err)
	require.Equal(t, &IPLocation{IP: "111.58.230.113", Country: "中国", CountryCode: "CN", Region: "广西", City: "南宁", Network: "中国移动"}, location)
	require.EqualValues(t, 1, calls.Load())
	require.True(t, server.Exists("ip-location:ip9:v1:111.58.230.113"))
	legacy, err := server.Get("ip-location:v1:111.58.230.113")
	require.NoError(t, err)
	require.Equal(t, oldLocation, legacy)
}

func TestIPLocationIP9SupportsIPv6WithCountryAndNetworkOnly(t *testing.T) {
	const ip = "2606:4700:4700::1111"
	setupIPLocationTest(t, func(r *http.Request) (*http.Response, error) {
		assert.Equal(t, "https", r.URL.Scheme)
		assert.Equal(t, "ip9.com.cn", r.URL.Host)
		assert.Equal(t, "/get", r.URL.Path)
		assert.Equal(t, ip, r.URL.Query().Get("ip"))
		return ipLocationResponse(`{"ret":200,"data":{"ip":"2606:4700:4700:0:0:0:0:1111","country":"美国","country_code":"us","prov":"","city":"","isp":"Cloudflare"}}`, 200), nil
	})
	location, err := QueryIPLocation(context.Background(), ip)
	require.NoError(t, err)
	require.Equal(t, &IPLocation{IP: ip, Country: "美国", CountryCode: "US", Network: "Cloudflare"}, location)
}

func TestIPLocationConcurrentLookupsContactProviderOnce(t *testing.T) {
	var calls atomic.Int32
	setupIPLocationTest(t, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		return ipLocationResponse(validIPLocationResponse, http.StatusOK), nil
	})
	var wg sync.WaitGroup
	for range 12 {
		wg.Go(func() {
			location, err := QueryIPLocation(context.Background(), "8.8.8.8")
			require.NoError(t, err)
			require.NotNil(t, location)
		})
	}
	wg.Wait()
	require.EqualValues(t, 1, calls.Load())
}

func TestIPLocationUnavailableRedisDoesNotContactProvider(t *testing.T) {
	server := setupIPLocationTest(t, func(*http.Request) (*http.Response, error) {
		t.Error("lookup contacted provider without usable Redis")
		return nil, fmt.Errorf("unexpected lookup")
	})
	common.RedisEnabled = false
	cached, err := GetCachedIPLocation(context.Background(), "8.8.8.8")
	require.NoError(t, err)
	require.Nil(t, cached)
	_, err = QueryIPLocation(context.Background(), "8.8.8.8")
	require.Error(t, err)
	common.RedisEnabled = true
	server.Close()
	_, err = QueryIPLocation(context.Background(), "8.8.8.8")
	require.Error(t, err)
}
