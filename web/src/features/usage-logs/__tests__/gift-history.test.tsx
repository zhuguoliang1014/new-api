import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { UsageLogs } from '..'

const clients: QueryClient[] = []
afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.setUser(null)
})

async function renderLogs(initialEntry: string, role = 1) {
  useAuthStore.getState().auth.setUser({ id: 7, username: 'wallet-user', role })
  const request = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/status') return { data: { success: true, data: {} } }
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
        data: { items: [], total: 0, quota: 0, rpm: 0, tpm: 0 },
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
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('tab', { name: 'Gift credit history' })
  return { router, request }
}

it('opens gift history from logs on demand and preserves common log filters when switching back', async () => {
  const { router, request } = await renderLogs(
    '/usage-logs/common?model=gpt-demo'
  )
  expect(
    request.mock.calls.some(([url]) => url === '/api/user/self/gifts')
  ).toBe(false)
  await userEvent.click(
    screen.getByRole('tab', { name: 'Gift credit history' })
  )
  expect(await screen.findByText('No gift credits yet')).toBeVisible()
  expect(router.state.location.search).toMatchObject({
    model: 'gpt-demo',
    view: 'gifts',
  })
  expect(
    screen.queryByRole('combobox', { name: 'Type' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Common Logs' }))
  await waitFor(() => expect(router.state.location.search.view).toBeUndefined())
  expect(router.state.location.search.model).toBe('gpt-demo')
  expect(await screen.findByRole('combobox', { name: 'Type' })).toBeVisible()
})

it('loads a direct gift-history link for the current account even for an administrator', async () => {
  const { request } = await renderLogs('/usage-logs/common?view=gifts', 100)
  expect(await screen.findByText('No gift credits yet')).toBeVisible()
  expect(
    screen.getByRole('tab', { name: 'Gift credit history' })
  ).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('tab', { name: 'All' })).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledWith('/api/user/self/gifts', {
    params: { p: 1, page_size: 10 },
  })
  expect(request.mock.calls.some(([url]) => url.startsWith('/api/log'))).toBe(
    false
  )
})
