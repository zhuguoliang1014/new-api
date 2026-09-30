package model

import "strings"

// Retired options may still exist in older installations. Ignore them when
// loading settings and reject writes without deleting persisted user data.
func isRetiredLocalIntegrationOption(key string) bool {
	return strings.HasPrefix(key, "WechatBot") ||
		strings.HasPrefix(key, "channel_health_alert_setting.") ||
		key == "HupijiaoInviteRewardRatio"
}
