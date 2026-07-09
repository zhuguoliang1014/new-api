import { SettingsPage } from '@/features/system-settings/components/settings-page'

import {
  CUSTOM_INTEGRATIONS_DEFAULT_SECTION,
  getCustomIntegrationsSectionContent,
  getCustomIntegrationsSectionMeta,
} from './section-registry'
import type { CustomIntegrationSettings } from './types'

const defaultSettings: CustomIntegrationSettings = {
  WechatBotEnabled: false,
  WechatBotUserId: '',
  WechatBotGroupIds: '',
  'channel_health_alert_setting.enabled': false,
  'channel_health_alert_setting.check_interval_seconds': 60,
  'channel_health_alert_setting.wechat_group_ids': '57047022764@chatroom',
  'channel_health_alert_setting.rules': [
    {
      id: 'high_error_rate',
      name: 'High error rate',
      enabled: true,
      window_minutes: 5,
      cooldown_minutes: 15,
      scope: {},
      condition: {
        and: [
          { metric: 'total_count', op: '>=', value: 10 },
          { metric: 'error_count', op: '>=', value: 5 },
          { metric: 'error_rate', op: '>=', value: 50 },
        ],
      },
    },
    {
      id: 'high_latency',
      name: 'High latency',
      enabled: true,
      window_minutes: 5,
      cooldown_minutes: 15,
      scope: {},
      condition: {
        and: [
          { metric: 'success_count', op: '>=', value: 10 },
          {
            or: [
              { metric: 'avg_ttft_ms', op: '>=', value: 8000 },
              { metric: 'avg_latency_ms', op: '>=', value: 60000 },
            ],
          },
        ],
      },
    },
  ],
  HupijiaoPrice: 7.3,
  HupijiaoAmountOptions: '[]',
  HupijiaoAmountDiscount: '{}',
  HupijiaoEnabled: false,
  HupijiaoAppId: '',
  HupijiaoAppSecret: '',
  HupijiaoApiUrl: 'https://api.xunhupay.com/payment/do.html',
  HupijiaoNotifyUrl: '',
  HupijiaoReturnUrl: '',
  HupijiaoMinTopUp: 1,
  HupijiaoInviteRewardRatio: 0.2,
}

export function CustomIntegrationsSettings() {
  return (
    <SettingsPage
      routePath='/_authenticated/system-settings/custom-integrations/$section'
      defaultSettings={defaultSettings}
      defaultSection={CUSTOM_INTEGRATIONS_DEFAULT_SECTION}
      getSectionContent={getCustomIntegrationsSectionContent}
      getSectionMeta={getCustomIntegrationsSectionMeta}
    />
  )
}
