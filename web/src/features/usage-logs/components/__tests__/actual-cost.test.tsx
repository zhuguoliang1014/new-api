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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { CommonLogsStats } from '../common-logs-stats'
import { UsageLogsProvider, useUsageLogsContext } from '../usage-logs-provider'

function StatsFixture() {
  const { sensitiveVisible, setSensitiveVisible, setViewScope } =
    useUsageLogsContext()
  return (
    <>
      <button
        type='button'
        onClick={() => setSensitiveVisible(!sensitiveVisible)}
      >
        Toggle amounts
      </button>
      <button type='button' onClick={() => setViewScope('self')}>
        My logs
      </button>
      <CommonLogsStats />
    </>
  )
}

async function renderStats(cost: number | null, estimated = false) {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'alice', role: ROLE.ADMIN })
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: true,
      data: {
        quota: 5000000,
        actual_cost_cny: cost,
        actual_cost_estimated: estimated,
        rpm: 2,
        tpm: 100,
      },
    },
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: StatsFixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({
      initialEntries: ['/usage-logs/common?model=gpt-a'],
    }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <UsageLogsProvider>
          <RouterProvider router={router} />
        </UsageLogsProvider>
      </TooltipProvider>
    </QueryClientProvider>
  )
  await screen.findByText('Actual Cost')
  await waitFor(() => expect(client.isFetching()).toBe(0))
  return get
}

afterEach(() => {
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
})

test('places CNY cost between usage and RPM and preserves filters in personal view', async () => {
  const user = userEvent.setup()
  const get = await renderStats((10 * 300) / 1155)
  expect(screen.getByText('¥2.5974')).toBeVisible()
  const labels = ['Usage', 'Actual Cost', 'RPM', 'TPM'].map((label) =>
    screen.getByText(label)
  )
  for (let i = 1; i < labels.length; i++) {
    expect(
      labels[i - 1].compareDocumentPosition(labels[i]) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  }
  expect(get.mock.calls[0][0]).toContain('/api/log/stat?')
  expect(get.mock.calls[0][0]).toContain('model_name=gpt-a')
  await user.click(screen.getByRole('button', { name: 'My logs' }))
  await waitFor(() =>
    expect(
      get.mock.calls.some(
        ([url]) =>
          url.startsWith('/api/log/self/stat?') &&
          url.includes('model_name=gpt-a')
      )
    ).toBe(true)
  )
  await user.click(screen.getByRole('button', { name: 'Toggle amounts' }))
  expect(screen.queryByText('¥2.5974')).not.toBeInTheDocument()
  expect(screen.getAllByText('••••')).toHaveLength(2)
  expect(screen.getByText('100')).toBeVisible()
})

test.each([
  {
    cost: 2.5974025974,
    estimated: true,
    value: '≈¥2.5974',
    explanation: 'Estimated CNY cost:',
  },
  {
    cost: null,
    estimated: false,
    value: '-',
    explanation: 'Actual cost is unavailable',
  },
  { cost: 0, estimated: false, value: '¥0', explanation: 'CNY equivalent:' },
])(
  'shows the $value amount and its explanation',
  async ({ cost, estimated, value, explanation }) => {
    const user = userEvent.setup()
    await renderStats(cost, estimated)
    expect(screen.getByText(value)).toBeVisible()
    await user.hover(screen.getByText('Actual Cost'))
    expect(await screen.findByText(new RegExp(explanation))).toBeVisible()
  }
)
