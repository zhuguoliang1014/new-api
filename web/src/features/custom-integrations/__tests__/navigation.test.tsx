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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'

import { Route as SectionRoute } from '@/routes/_authenticated/system-settings/custom-integrations/$section'
import { Route as IndexRoute } from '@/routes/_authenticated/system-settings/custom-integrations/index'

import { getCustomIntegrationsSectionNavItems } from '../section-registry'

describe('add-on settings navigation', () => {
  it('shows Hupijiao as the only add-on entry', () => {
    expect(getCustomIntegrationsSectionNavItems(i18next.t)).toEqual([
      {
        title: 'Hupijiao Gateway',
        url: '/system-settings/custom-integrations/hupijiao',
      },
    ])
  })

  it.each([
    '/system-settings/custom-integrations',
    '/system-settings/custom-integrations/wechat-bot',
    '/system-settings/custom-integrations/channel-health-alerts',
    '/system-settings/custom-integrations/invite-rewards',
    '/system-settings/custom-integrations/unknown',
    '/system-settings/custom-integrations/hupijiao',
  ])('opening %s lands on the Hupijiao payment settings', async (href) => {
    const root = createRootRoute()
    const indexOptions = {
      ...IndexRoute.options,
      id: '/system-settings/custom-integrations/',
      path: '/system-settings/custom-integrations/',
      getParentRoute: () => root,
    }
    const sectionOptions = {
      ...SectionRoute.options,
      id: '/system-settings/custom-integrations/$section',
      path: '/system-settings/custom-integrations/$section',
      getParentRoute: () => root,
    }
    const index = IndexRoute.update(indexOptions)
    const section = SectionRoute.update(sectionOptions)
    const router = createRouter({
      routeTree: root.addChildren([index, section]),
      history: createMemoryHistory({ initialEntries: [href] }),
    })

    await router.load()

    expect(router.state.location.pathname).toBe(
      '/system-settings/custom-integrations/hupijiao'
    )
    expect(router.state.matches.at(-1)?.params).toMatchObject({
      section: 'hupijiao',
    })
  })
})
