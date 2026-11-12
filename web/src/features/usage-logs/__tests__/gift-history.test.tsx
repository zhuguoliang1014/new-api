import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { UsageLogs } from '..'

test('shows gift events in common logs without a separate tab or gift-history request', async () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 7, username: 'wallet-user', role: 1 })
  const request = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/user/self/groups') {
      return { data: { success: true, data: {} } }
    }
    if (url === '/api/subscription/self') {
      return {
        data: {
          success: true,
          data: { subscriptions: [], all_subscriptions: [] },
        },
      }
    }
    return {
      data: {
        success: true,
        data: {
          items: url.startsWith('/api/log/self?')
            ? [
                {
                  id: 1,
                  user_id: 7,
                  created_at: Math.floor(Date.now() / 1000),
                  type: 4,
                  content: 'Gift credit granted: $5',
                  other: '',
                },
              ]
            : [],
          total: 1,
          quota: 0,
          rpm: 0,
          tpm: 0,
        },
      },
    }
  })
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: UsageLogs,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({
      initialEntries: ['/usage-logs/common?view=gifts'],
    }),
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )

  expect(await screen.findByText('Gift credit granted: $5')).toBeVisible()
  expect(
    screen.queryByRole('tab', { name: 'Gift credit history' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Gift credit history' })
  ).not.toBeInTheDocument()
  expect(
    request.mock.calls.some(([url]) => url === '/api/user/self/gifts')
  ).toBe(false)
})
