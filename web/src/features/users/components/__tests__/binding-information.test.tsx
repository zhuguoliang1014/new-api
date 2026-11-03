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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import type { CustomOAuthBinding } from '@/lib/oauth'
import { useAuthStore } from '@/stores/auth-store'

import type { User } from '../../types'
import { UsersMutateDrawer } from '../users-mutate-drawer'
import { UsersProvider } from '../users-provider'

const target: User = {
  id: 2,
  username: 'member',
  display_name: 'Member',
  role: 1,
  status: 1,
  quota: 0,
  used_quota: 0,
  request_count: 0,
  group: 'default',
}
const yaohuo: CustomOAuthBinding = {
  provider_id: 42,
  provider_name: '妖火网',
  provider_slug: 'yaohuo',
  provider_icon: '',
  provider_user_id: '12345',
}
const clients: QueryClient[] = []

function renderDrawer(currentRow: User | undefined = target, open = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  clients.push(client)
  function drawer(row: User | undefined, isOpen: boolean) {
    return (
      <QueryClientProvider client={client}>
        <UsersProvider>
          <UsersMutateDrawer
            open={isOpen}
            onOpenChange={() => undefined}
            currentRow={row}
          />
        </UsersProvider>
      </QueryClientProvider>
    )
  }
  const result = render(drawer(currentRow, open))
  return {
    ...result,
    show: (row: User | undefined, isOpen = true) =>
      result.rerender(drawer(row, isOpen)),
  }
}

async function defaultGet(url: string) {
  if (url === '/api/group/') {
    return { data: { success: true, data: ['default'] } }
  }
  if (url === '/api/authz/catalog') {
    return { data: { success: true, data: { resources: [], roles: [] } } }
  }
  if (url.endsWith('/oauth/bindings')) {
    return { data: { success: true, data: [yaohuo] } }
  }
  return { data: { success: true, data: target } }
}

beforeEach(() => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'operator', role: 100 })
  vi.spyOn(api, 'get').mockImplementation(defaultGet)
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
})

it('shows the Yaohuo authorization account in user binding information without depending on enabled providers', async () => {
  renderDrawer()
  const identity = await screen.findByRole('textbox', { name: '妖火网' })
  expect(identity).toHaveValue('12345')
  expect(identity).toBeDisabled()
  expect(api.get).toHaveBeenCalledWith('/api/user/2/oauth/bindings')
  expect(api.get).not.toHaveBeenCalledWith('/api/status')
})

it('shows all returned custom authorizations and keeps long identities available in full', async () => {
  const longIdentity = 'external-identity-'.repeat(20)
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (String(url).endsWith('/oauth/bindings')) {
      return {
        data: {
          success: true,
          data: [
            yaohuo,
            {
              ...yaohuo,
              provider_id: 43,
              provider_name: 'Archived provider',
              provider_slug: 'archived',
              provider_user_id: longIdentity,
            },
          ],
        },
      }
    }
    return defaultGet(url)
  })
  renderDrawer()
  expect(await screen.findByRole('textbox', { name: '妖火网' })).toHaveValue(
    '12345'
  )
  const identity = await screen.findByRole('textbox', {
    name: 'Archived provider',
  })
  expect(identity).toHaveValue(longIdentity)
  expect(identity).toHaveAttribute('title', longIdentity)
  expect(identity).toBeDisabled()
})

it.each(['network', 'business'] as const)(
  'offers retry when authorization lookup has a %s failure',
  async (failure) => {
    let fail = true
    vi.mocked(api.get).mockImplementation(async (url) => {
      if (String(url).endsWith('/oauth/bindings') && fail) {
        if (failure === 'network') throw new Error('offline')
        return { data: { success: false, message: 'Cannot read bindings' } }
      }
      return defaultGet(url)
    })
    renderDrawer()
    expect(await screen.findByText('Failed to load')).toBeVisible()
    expect(
      screen.queryByRole('textbox', { name: '妖火网' })
    ).not.toBeInTheDocument()
    fail = false
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('textbox', { name: '妖火网' })).toHaveValue(
      '12345'
    )
  }
)

it('does not show a previous user authorization while the next user loads or when their bindings are empty', async () => {
  let resolveSecond!: (value: {
    data: { success: boolean; data: CustomOAuthBinding[] }
  }) => void
  const pending = new Promise<{
    data: { success: boolean; data: CustomOAuthBinding[] }
  }>((resolve) => {
    resolveSecond = resolve
  })
  vi.mocked(api.get).mockImplementation(async (url) =>
    url === '/api/user/3/oauth/bindings' ? pending : defaultGet(url)
  )
  const drawer = renderDrawer()
  expect(await screen.findByRole('textbox', { name: '妖火网' })).toHaveValue(
    '12345'
  )
  drawer.show({ ...target, id: 3, username: 'another-member' })
  expect(
    screen.queryByRole('textbox', { name: '妖火网' })
  ).not.toBeInTheDocument()
  expect(await screen.findByText('Loading...')).toBeVisible()
  await act(async () => resolveSecond({ data: { success: true, data: [] } }))
  await waitFor(() =>
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
  )
  expect(
    screen.queryByRole('textbox', { name: '妖火网' })
  ).not.toBeInTheDocument()
  expect(screen.getByText('Binding Information')).toBeVisible()
})

it('only requests authorizations when an existing user drawer is open', async () => {
  const drawer = renderDrawer(target, false)
  expect(api.get).not.toHaveBeenCalledWith('/api/user/2/oauth/bindings')
  drawer.show(undefined)
  expect(
    await screen.findByText('Add a new user by providing necessary info.')
  ).toBeVisible()
  expect(api.get).not.toHaveBeenCalledWith('/api/user/2/oauth/bindings')
  drawer.show(target)
  expect(await screen.findByRole('textbox', { name: '妖火网' })).toHaveValue(
    '12345'
  )
})
