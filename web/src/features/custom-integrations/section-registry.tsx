import type { TFunction } from 'i18next'

/* eslint-disable react-refresh/only-export-components */
import { customIntegrationsNavigation } from '@/features/system-settings/section-navigation'
import { createSectionRegistry } from '@/features/system-settings/utils/section-registry'

import { HupijiaoSettingsSection } from './hupijiao-settings-section'
import { ResponsesWebSocketSettingsSection } from './responses-websocket-settings-section'
import type { CustomIntegrationSettings } from './types'

function resolveAddonDefaults(
  settings: CustomIntegrationSettings
): CustomIntegrationSettings {
  return {
    ResponsesWSMaxConnectionsPerUser:
      settings.ResponsesWSMaxConnectionsPerUser ?? 10,
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
  }
}

const CUSTOM_INTEGRATIONS_SECTIONS = [
  {
    ...customIntegrationsNavigation.getSectionMeta('hupijiao'),
    build: (settings: CustomIntegrationSettings) => (
      <HupijiaoSettingsSection defaultValues={resolveAddonDefaults(settings)} />
    ),
  },
  {
    ...customIntegrationsNavigation.getSectionMeta('responses-websocket'),
    build: (settings: CustomIntegrationSettings) => (
      <ResponsesWebSocketSettingsSection
        defaultValues={{
          ResponsesWSMaxConnectionsPerUser:
            settings.ResponsesWSMaxConnectionsPerUser ?? 10,
        }}
      />
    ),
  },
] as const

export type CustomIntegrationSectionId =
  (typeof customIntegrationsNavigation.sectionIds)[number]

const registry = createSectionRegistry<
  CustomIntegrationSectionId,
  CustomIntegrationSettings
>({
  sections: CUSTOM_INTEGRATIONS_SECTIONS,
  defaultSection: customIntegrationsNavigation.defaultSection,
  basePath: '/system-settings/custom-integrations',
  urlStyle: 'path',
})

export const CUSTOM_INTEGRATIONS_SECTION_IDS =
  customIntegrationsNavigation.sectionIds
export const CUSTOM_INTEGRATIONS_DEFAULT_SECTION =
  customIntegrationsNavigation.defaultSection
export const getCustomIntegrationsSectionNavItems = (t: TFunction) =>
  customIntegrationsNavigation.getSectionNavItems(t)
export const getCustomIntegrationsSectionContent = registry.getSectionContent
export const getCustomIntegrationsSectionMeta = registry.getSectionMeta
