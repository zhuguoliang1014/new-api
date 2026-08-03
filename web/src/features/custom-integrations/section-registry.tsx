/* eslint-disable react-refresh/only-export-components */
import type { TFunction } from 'i18next'

import { createSectionRegistry } from '@/features/system-settings/utils/section-registry'

import { ChannelHealthAlertSection } from './channel-health-alert-section'
import { HupijiaoSettingsSection } from './hupijiao-settings-section'
import { InviteRewardsSection } from './invite-rewards-section'
import type { CustomIntegrationSettings } from './types'
import { WechatBotSection } from './wechat-bot-section'

function resolveAddonDefaults(
  settings: CustomIntegrationSettings
): CustomIntegrationSettings {
  return {
    WechatBotEnabled: settings.WechatBotEnabled ?? false,
    WechatBotUserId: settings.WechatBotUserId ?? '',
    WechatBotGroupIds: settings.WechatBotGroupIds ?? '',
    'channel_health_alert_setting.enabled':
      settings['channel_health_alert_setting.enabled'] ?? false,
    'channel_health_alert_setting.check_interval_seconds':
      settings['channel_health_alert_setting.check_interval_seconds'] ?? 60,
    'channel_health_alert_setting.wechat_group_ids':
      settings['channel_health_alert_setting.wechat_group_ids'] ??
      '57047022764@chatroom',
    'channel_health_alert_setting.rules':
      settings['channel_health_alert_setting.rules'] ?? [],
    HupijiaoPrice: settings.HupijiaoPrice ?? 7.3,
    HupijiaoAmountOptions: settings.HupijiaoAmountOptions ?? '[]',
    HupijiaoAmountDiscount: settings.HupijiaoAmountDiscount ?? '{}',
    HupijiaoEnabled: settings.HupijiaoEnabled ?? false,
    HupijiaoAppId: settings.HupijiaoAppId ?? '',
    HupijiaoAppSecret: settings.HupijiaoAppSecret ?? '',
    HupijiaoApiUrl:
      settings.HupijiaoApiUrl ?? 'https://api.xunhupay.com/payment/do.html',
    HupijiaoNotifyUrl: settings.HupijiaoNotifyUrl ?? '',
    HupijiaoReturnUrl: settings.HupijiaoReturnUrl ?? '',
    HupijiaoMinTopUp: settings.HupijiaoMinTopUp ?? 1,
    HupijiaoInviteRewardRatio: settings.HupijiaoInviteRewardRatio ?? 0.2,
  }
}

const CUSTOM_INTEGRATIONS_SECTIONS = [
  {
    id: 'wechat-bot',
    titleKey: 'WeChat Notifications',
    descriptionKey: 'Configure WeChat group notifications',
    build: (settings: CustomIntegrationSettings) => (
      <WechatBotSection defaultValues={resolveAddonDefaults(settings)} />
    ),
  },
  {
    id: 'channel-health-alerts',
    titleKey: 'Channel Health Alerts',
    descriptionKey: 'Configure channel error and latency alert rules',
    build: (settings: CustomIntegrationSettings) => (
      <ChannelHealthAlertSection
        defaultValues={resolveAddonDefaults(settings)}
      />
    ),
  },
  {
    id: 'hupijiao',
    titleKey: 'Hupijiao Gateway',
    descriptionKey: 'Configuration for Alipay payments through Hupijiao',
    build: (settings: CustomIntegrationSettings) => (
      <HupijiaoSettingsSection defaultValues={resolveAddonDefaults(settings)} />
    ),
  },
  {
    id: 'invite-rewards',
    titleKey: 'Invitation Rewards',
    descriptionKey:
      'Configure rewards for invited users who pay through Hupijiao',
    build: (settings: CustomIntegrationSettings) => (
      <InviteRewardsSection defaultValues={resolveAddonDefaults(settings)} />
    ),
  },
] as const

export type CustomIntegrationSectionId =
  (typeof CUSTOM_INTEGRATIONS_SECTIONS)[number]['id']

const registry = createSectionRegistry<
  CustomIntegrationSectionId,
  CustomIntegrationSettings
>({
  sections: CUSTOM_INTEGRATIONS_SECTIONS,
  defaultSection: 'wechat-bot',
  basePath: '/system-settings/custom-integrations',
  urlStyle: 'path',
})

export const CUSTOM_INTEGRATIONS_SECTION_IDS = registry.sectionIds
export const CUSTOM_INTEGRATIONS_DEFAULT_SECTION = registry.defaultSection
export const getCustomIntegrationsSectionNavItems = (t: TFunction) =>
  registry.getSectionNavItems(t)
export const getCustomIntegrationsSectionContent = registry.getSectionContent
export const getCustomIntegrationsSectionMeta = registry.getSectionMeta
