/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
// Route guards and sidebar menus import this module; page components stay in their lazy registries.
import { createSectionNavigation } from './utils/section-registry'

export const authNavigation = createSectionNavigation({
  sections: [
    { id: 'basic-auth', titleKey: 'Basic Authentication' },
    { id: 'oauth', titleKey: 'OAuth Integrations' },
    { id: 'passkey', titleKey: 'Passkey Authentication' },
    { id: 'bot-protection', titleKey: 'Bot Protection' },
    { id: 'custom-oauth', titleKey: 'Custom OAuth' },
  ] as const,
  defaultSection: 'basic-auth',
  basePath: '/system-settings/auth',
  urlStyle: 'path',
})

export const AUTH_SECTION_IDS = authNavigation.sectionIds
export const AUTH_DEFAULT_SECTION = authNavigation.defaultSection
export const getAuthSectionNavItems = authNavigation.getSectionNavItems

export const billingNavigation = createSectionNavigation({
  sections: [
    { id: 'quota', titleKey: 'Quota Settings' },
    { id: 'currency', titleKey: 'Currency & Display' },
    { id: 'model-pricing', titleKey: 'Model Pricing' },
    { id: 'group-pricing', titleKey: 'Group Pricing' },
    { id: 'payment', titleKey: 'Payment Gateway' },
    { id: 'checkin', titleKey: 'Check-in Rewards' },
  ] as const,
  defaultSection: 'quota',
  basePath: '/system-settings/billing',
  urlStyle: 'path',
})

export const BILLING_SECTION_IDS = billingNavigation.sectionIds
export const BILLING_DEFAULT_SECTION = billingNavigation.defaultSection
export const getBillingSectionNavItems = billingNavigation.getSectionNavItems

export const contentNavigation = createSectionNavigation({
  sections: [
    { id: 'dashboard', titleKey: 'Data Dashboard' },
    { id: 'announcements', titleKey: 'Announcements' },
    { id: 'api-info', titleKey: 'API Addresses' },
    { id: 'faq', titleKey: 'FAQ' },
    { id: 'uptime-kuma', titleKey: 'Uptime Kuma' },
    { id: 'chat', titleKey: 'Chat Presets' },
    { id: 'drawing', titleKey: 'Drawing' },
  ] as const,
  defaultSection: 'dashboard',
  basePath: '/system-settings/content',
  urlStyle: 'path',
})

export const CONTENT_SECTION_IDS = contentNavigation.sectionIds
export const CONTENT_DEFAULT_SECTION = contentNavigation.defaultSection
export const getContentSectionNavItems = contentNavigation.getSectionNavItems

export const modelsNavigation = createSectionNavigation({
  sections: [
    { id: 'global', titleKey: 'Global Model Configuration' },
    { id: 'gemini', titleKey: 'Gemini' },
    { id: 'claude', titleKey: 'Claude' },
    { id: 'grok', titleKey: 'Grok' },
    { id: 'model-deployment', titleKey: 'Model Deployment' },
  ] as const,
  defaultSection: 'global',
  basePath: '/system-settings/models',
  urlStyle: 'path',
})

export const MODELS_SECTION_IDS = modelsNavigation.sectionIds
export const MODELS_DEFAULT_SECTION = modelsNavigation.defaultSection
export const getModelsSectionNavItems = modelsNavigation.getSectionNavItems

export const operationsNavigation = createSectionNavigation({
  sections: [
    { id: 'behavior', titleKey: 'System Behavior' },
    { id: 'alerts', titleKey: 'Model performance metrics' },
    { id: 'email', titleKey: 'Email & Notifications' },
    { id: 'worker', titleKey: 'Worker Proxy' },
    { id: 'logs', titleKey: 'Log Maintenance' },
    { id: 'performance', titleKey: 'Performance' },
    { id: 'update-checker', titleKey: 'System maintenance' },
  ] as const,
  defaultSection: 'behavior',
  basePath: '/system-settings/operations',
  urlStyle: 'path',
})

export const OPERATIONS_SECTION_IDS = operationsNavigation.sectionIds
export const OPERATIONS_DEFAULT_SECTION = operationsNavigation.defaultSection
export const getOperationsSectionNavItems =
  operationsNavigation.getSectionNavItems

export const securityNavigation = createSectionNavigation({
  sections: [
    { id: 'rate-limit', titleKey: 'Rate Limiting' },
    { id: 'ssrf', titleKey: 'SSRF Protection' },
    { id: 'token-limits', titleKey: 'Token Limits' },
  ] as const,
  defaultSection: 'rate-limit',
  basePath: '/system-settings/security',
  urlStyle: 'path',
})

export const SECURITY_SECTION_IDS = securityNavigation.sectionIds
export const SECURITY_DEFAULT_SECTION = securityNavigation.defaultSection
export const getSecuritySectionNavItems = securityNavigation.getSectionNavItems

export const siteNavigation = createSectionNavigation({
  sections: [
    { id: 'system-info', titleKey: 'System Information' },
    { id: 'notice', titleKey: 'System Notice' },
    { id: 'header-navigation', titleKey: 'Header navigation' },
    { id: 'sidebar-modules', titleKey: 'Sidebar modules' },
  ] as const,
  defaultSection: 'system-info',
  basePath: '/system-settings/site',
  urlStyle: 'path',
})

export const SITE_SECTION_IDS = siteNavigation.sectionIds
export const SITE_DEFAULT_SECTION = siteNavigation.defaultSection
export const getSiteSectionNavItems = siteNavigation.getSectionNavItems

export const policyNavigation = createSectionNavigation({
  sections: [
    { id: 'filtering', titleKey: 'Request checks' },
    { id: 'routing', titleKey: 'Sessions and retries' },
    { id: 'health', titleKey: 'Channel health' },
  ] as const,
  defaultSection: 'routing',
  basePath: '/system-settings/request-policies',
  urlStyle: 'path',
})

export const POLICY_SECTION_IDS = policyNavigation.sectionIds
export const POLICY_DEFAULT_SECTION = policyNavigation.defaultSection
export const getPolicySectionNavItems = policyNavigation.getSectionNavItems

export const customIntegrationsNavigation = createSectionNavigation({
  sections: [
    {
      id: 'hupijiao',
      titleKey: 'Hupijiao Gateway',
      descriptionKey: 'Configuration for Alipay payments through Hupijiao',
    },
    {
      id: 'responses-websocket',
      titleKey: 'Responses WebSocket',
    },
  ] as const,
  defaultSection: 'hupijiao',
  basePath: '/system-settings/custom-integrations',
  urlStyle: 'path',
})

export const CUSTOM_INTEGRATIONS_SECTION_IDS =
  customIntegrationsNavigation.sectionIds
export const CUSTOM_INTEGRATIONS_DEFAULT_SECTION =
  customIntegrationsNavigation.defaultSection
export const getCustomIntegrationsSectionNavItems =
  customIntegrationsNavigation.getSectionNavItems
