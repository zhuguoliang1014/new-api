package controller

// Hupijiao webhook/availability check — local fork addition. Pure helper, no
// side effects; lives here so payment_webhook_availability.go stays close to
// upstream.

import (
	"strings"

	"github.com/QuantumNous/new-api/setting"
)

func isHupijiaoTopUpEnabled() bool {
	return setting.HupijiaoEnabled &&
		strings.TrimSpace(setting.HupijiaoAppId) != "" &&
		strings.TrimSpace(setting.HupijiaoAppSecret) != "" &&
		strings.TrimSpace(setting.HupijiaoApiUrl) != ""
}
