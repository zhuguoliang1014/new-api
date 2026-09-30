package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRemovedIntegrationOptionsCannotBeUpdated(t *testing.T) {
	for _, key := range []string{
		"WechatBotEnabled", "WechatBotUserId", "WechatBotGroupIds",
		"channel_health_alert_setting.enabled", "channel_health_alert_setting.rules",
		"HupijiaoInviteRewardRatio",
	} {
		t.Run(key, func(t *testing.T) {
			require.Error(t, UpdateOption(key, "true"))
			require.Error(t, UpdateOptionsBulk(map[string]string{key: "true"}))
		})
	}
}

func TestStoredRemovedIntegrationOptionsAreNotExposed(t *testing.T) {
	common.OptionMapRWMutex.Lock()
	original := common.OptionMap
	common.OptionMap = map[string]string{
		"WechatBotEnabled":                     "true",
		"channel_health_alert_setting.enabled": "true",
		"HupijiaoInviteRewardRatio":            "0.2",
	}
	common.OptionMapRWMutex.Unlock()
	t.Cleanup(func() {
		common.OptionMapRWMutex.Lock()
		common.OptionMap = original
		common.OptionMapRWMutex.Unlock()
	})

	for _, key := range []string{
		"WechatBotEnabled", "channel_health_alert_setting.enabled", "HupijiaoInviteRewardRatio",
	} {
		require.NoError(t, updateOptionMap(key, "true"))
		common.OptionMapRWMutex.RLock()
		_, exists := common.OptionMap[key]
		common.OptionMapRWMutex.RUnlock()
		assert.False(t, exists, "retired option must not appear in settings responses")
	}
}
