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
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'

import {
  createSectionNavigation,
  createSectionRegistry,
} from '../section-registry'

const sections = [
  { id: 'overview', titleKey: 'Overview' },
  { id: 'details', titleKey: 'Details' },
] as const

describe('section navigation', () => {
  it('preserves section order, translated labels and path URLs without page content', async () => {
    const translator = i18next.createInstance()
    await translator.init({
      lng: 'en',
      resources: {
        en: {
          translation: {
            Overview: 'Translated overview',
            Details: 'Translated details',
          },
        },
      },
    })
    const navigation = createSectionNavigation({
      sections,
      defaultSection: 'details',
      basePath: '/settings',
      urlStyle: 'path',
    })
    expect(navigation.sectionIds).toEqual(['overview', 'details'])
    expect(navigation.defaultSection).toBe('details')
    expect(navigation.getSectionNavItems(translator.t)).toEqual([
      { title: 'Translated overview', url: '/settings/overview' },
      { title: 'Translated details', url: '/settings/details' },
    ])
  })

  it('preserves query URLs and falls back to the first section for invalid IDs', () => {
    const navigation = createSectionNavigation({
      sections,
      defaultSection: 'details',
      basePath: '/settings',
    })
    expect(navigation.getSectionNavItems(i18next.t)[1].url).toBe(
      '/settings?section=details'
    )
    expect(navigation.getSectionMeta('invalid' as 'overview')).toEqual(
      sections[0]
    )
  })

  it('keeps page builders and their settings and extra arguments working', () => {
    const registry = createSectionRegistry<
      'overview' | 'details',
      { value: string },
      [string]
    >({
      sections: sections.map((section) => ({
        ...section,
        build: (settings: { value: string }, suffix: string) =>
          `${section.id}:${settings.value}:${suffix}`,
      })),
      defaultSection: 'overview',
      basePath: '/settings',
    })
    expect(
      registry.getSectionContent('details', { value: 'saved' }, 'extra')
    ).toBe('details:saved:extra')
    expect(
      registry.getSectionContent(
        'invalid' as 'overview',
        { value: 'fallback' },
        'extra'
      )
    ).toBe('overview:fallback:extra')
  })
})
