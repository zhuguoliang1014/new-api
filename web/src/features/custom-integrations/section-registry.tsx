/* eslint-disable react-refresh/only-export-components */
import type { TFunction } from 'i18next'

import { createSectionRegistry } from '@/features/system-settings/utils/section-registry'

import { HupijiaoSettingsSection } from './hupijiao-settings-section'
import type { CustomIntegrationSettings } from './types'

function resolveAddonDefaults(
  settings: CustomIntegrationSettings
): CustomIntegrationSettings {
  return {
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
    id: 'hupijiao',
    titleKey: 'Hupijiao Gateway',
    descriptionKey: 'Configuration for Alipay payments through Hupijiao',
    build: (settings: CustomIntegrationSettings) => (
      <HupijiaoSettingsSection defaultValues={resolveAddonDefaults(settings)} />
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
  defaultSection: 'hupijiao',
  basePath: '/system-settings/custom-integrations',
  urlStyle: 'path',
})

export const CUSTOM_INTEGRATIONS_SECTION_IDS = registry.sectionIds
export const CUSTOM_INTEGRATIONS_DEFAULT_SECTION = registry.defaultSection
export const getCustomIntegrationsSectionNavItems = (t: TFunction) =>
  registry.getSectionNavItems(t)
export const getCustomIntegrationsSectionContent = registry.getSectionContent
export const getCustomIntegrationsSectionMeta = registry.getSectionMeta
