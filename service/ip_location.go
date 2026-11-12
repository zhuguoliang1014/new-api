package service

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/go-redis/redis/v8"
	"golang.org/x/sync/singleflight"
)

const ipLocationCacheTTL = 30 * 24 * time.Hour

// Include the provider so results and cooldowns from an older data source are
// never reused when changing lookup services.
const ipLocationCachePrefix = "ip-location:ip9:v1:"
const ipLocationQueryPrefix = "ip-location:query:ip9:v1:"

var ipLocationRequests singleflight.Group
var ipLocationHTTPClient = &http.Client{
	Timeout:       5 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
}

type IPLocation struct {
	IP          string `json:"ip"`
	Country     string `json:"country"`
	CountryCode string `json:"country_code"`
	Region      string `json:"region"`
	City        string `json:"city"`
	Network     string `json:"network"`
}

func NormalizeLocationIP(value string) (string, error) {
	ip, err := netip.ParseAddr(value)
	if err != nil || ip.Zone() != "" {
		return "", common.NewMessage("Invalid IP address")
	}
	return ip.Unmap().String(), nil
}

// Private, local and documentation addresses must never leave the gateway.
func CanQueryIPLocation(value string) bool {
	ip, err := netip.ParseAddr(value)
	if err != nil {
		return false
	}
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, prefix := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32"} {
		if netip.MustParsePrefix(prefix).Contains(ip) {
			return false
		}
	}
	return true
}

func IPLocationCacheAvailable() bool {
	return common.RedisEnabled && common.RDB != nil
}

// Cache reads deliberately never contact the external lookup service.
func GetCachedIPLocation(ctx context.Context, ip string) (*IPLocation, error) {
	if !IPLocationCacheAvailable() {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	data, err := common.RDB.Get(ctx, ipLocationCachePrefix+ip).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, common.NewMessage("IP location cache is unavailable")
	}
	var location IPLocation
	if json.Unmarshal(data, &location) != nil || location.IP != ip || (location.Country == "" && location.Region == "" && location.City == "" && location.Network == "") {
		return nil, nil
	}
	return &location, nil
}

func QueryIPLocation(ctx context.Context, ip string) (*IPLocation, error) {
	if !IPLocationCacheAvailable() {
		return nil, common.NewMessage("IP location cache is unavailable")
	}
	if !CanQueryIPLocation(ip) {
		return nil, common.NewMessage("Only public IP addresses can be queried")
	}
	result := ipLocationRequests.DoChan(ip, func() (any, error) {
		// Finish the shared lookup even if one viewer closes their dialog.
		lookupCtx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		if cached, err := GetCachedIPLocation(lookupCtx, ip); cached != nil || err != nil {
			return cached, err
		}
		// A short Redis lease also suppresses duplicate calls across app instances,
		// and leaves a cooldown on failures without caching a false location.
		lockKey := ipLocationQueryPrefix + ip
		locked, err := common.RDB.SetNX(lookupCtx, lockKey, "1", 15*time.Second).Result()
		if err != nil {
			return nil, common.NewMessage("IP location cache is unavailable")
		}
		if !locked {
			return nil, common.NewMessage("IP lookup is busy. Please try again shortly.")
		}
		location, err := fetchIPLocation(lookupCtx, ip)
		if err != nil {
			return nil, err
		}
		data, err := json.Marshal(location)
		if err != nil {
			return nil, err
		}
		if err = common.RDB.Set(lookupCtx, ipLocationCachePrefix+ip, data, ipLocationCacheTTL).Err(); err != nil {
			return nil, common.NewMessage("IP location cache is unavailable")
		}
		return location, nil
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case response := <-result:
		if response.Err != nil {
			return nil, response.Err
		}
		return response.Val.(*IPLocation), nil
	}
}

func fetchIPLocation(ctx context.Context, ip string) (*IPLocation, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://ip9.com.cn/get?ip="+url.QueryEscape(ip), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	response, err := ipLocationHTTPClient.Do(req)
	if err != nil {
		return nil, common.NewMessage("IP location lookup failed. Please try again later.")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, common.NewMessage("IP location lookup failed. Please try again later.")
	}
	var payload struct {
		Ret  int `json:"ret"`
		Data struct {
			IP          string `json:"ip"`
			Country     string `json:"country"`
			CountryCode string `json:"country_code"`
			Province    string `json:"prov"`
			City        string `json:"city"`
			ISP         string `json:"isp"`
		} `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&payload) != nil || payload.Ret != 200 {
		return nil, common.NewMessage("IP location lookup failed. Please try again later.")
	}
	responseIP, err := NormalizeLocationIP(payload.Data.IP)
	if err != nil || responseIP != ip {
		return nil, common.NewMessage("IP location lookup failed. Please try again later.")
	}
	location := &IPLocation{
		IP:          ip,
		Country:     strings.TrimSpace(payload.Data.Country),
		CountryCode: strings.ToUpper(strings.TrimSpace(payload.Data.CountryCode)),
		Region:      strings.TrimSpace(payload.Data.Province),
		City:        strings.TrimSpace(payload.Data.City),
		Network:     strings.TrimSpace(payload.Data.ISP),
	}
	if location.Country == "" && location.Region == "" && location.City == "" && location.Network == "" {
		return nil, common.NewMessage("IP location lookup failed. Please try again later.")
	}
	return location, nil
}
