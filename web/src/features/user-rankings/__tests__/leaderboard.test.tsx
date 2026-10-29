import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  createRoute,
  Outlet,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DatePicker } from '@/components/date-picker'
import { api } from '@/lib/api'

import { UserRankings, UserRankingsBoard } from '..'
import type { DailyUserRankings } from '../api'

const fixture: DailyUserRankings = {
  date: '2026-10-29',
  timezone: 'Asia/Shanghai',
  generated_at: 1793232000,
  next_reset_at: 1793289600,
  total_tokens: 1400,
  participants: 3,
  limit: 100,
  me: {
    rank: 2,
    name: 'b***b',
    input_tokens: 300,
    output_tokens: 200,
    total_tokens: 500,
    is_me: true,
  },
  rows: [
    {
      rank: 1,
      name: 'a***a',
      input_tokens: 700,
      output_tokens: 100,
      total_tokens: 800,
      is_me: false,
    },
    {
      rank: 2,
      name: 'b***b',
      input_tokens: 300,
      output_tokens: 200,
      total_tokens: 500,
      is_me: true,
    },
    {
      rank: 3,
      name: 'c***c',
      input_tokens: 40,
      output_tokens: 60,
      total_tokens: 100,
      is_me: false,
    },
  ],
}

describe('daily user leaderboard', () => {
  it('shows request failures and reloads the leaderboard when Retry is clicked', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    let fail = true
    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/status') return { data: { success: true, data: {} } }
      if (url === '/api/rankings/users') {
        if (fail) throw new Error('offline')
        return { data: { success: true, data: { ...fixture, me: null } } }
      }
      throw new Error(`Unexpected URL: ${url}`)
    })
    const root = createRootRoute({ component: Outlet })
    const route = createRoute({
      getParentRoute: () => root,
      path: '/rankings/',
      component: UserRankings,
    })
    const router = createRouter({
      routeTree: root.addChildren([route]),
      history: createMemoryHistory({ initialEntries: ['/rankings/'] }),
    })
    await router.load()
    const view = render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
    try {
      expect(await screen.findByText('Unable to load rankings')).toBeVisible()
      fail = false
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(screen.getByRole('table')).toBeVisible())
      expect(
        screen.queryByText('Unable to load rankings')
      ).not.toBeInTheDocument()
    } finally {
      view.unmount()
      client.clear()
    }
  })

  it('limits date selection to the available day range', async () => {
    const onSelect = vi.fn()
    render(
      <DatePicker
        ariaLabel='Ranking date'
        selected={new Date(2026, 9, 15)}
        minDate={new Date(2026, 9, 10)}
        maxDate={new Date(2026, 9, 20)}
        onSelect={onSelect}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Ranking date' }))
    expect(screen.getByRole('button', { name: /October 9th/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /October 10th/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /October 20th/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /October 21st/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: /October 12th/ }))
    expect(onSelect).toHaveBeenCalledWith(
      new Date(2026, 9, 12),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('shows medals in rank order and identifies the current user', () => {
    render(<UserRankingsBoard data={fixture} signedIn />)
    expect(
      within(screen.getByRole('article', { name: 'Gold' })).getByText('a***a')
    ).toBeVisible()
    expect(
      within(screen.getByRole('article', { name: 'Silver' })).getByText('b***b')
    ).toBeVisible()
    expect(
      within(screen.getByRole('article', { name: 'Bronze' })).getByText('c***c')
    ).toBeVisible()
    expect(
      within(screen.getByRole('region', { name: 'My ranking' })).getByText('#2')
    ).toBeVisible()
    expect(screen.getByRole('table')).toHaveTextContent('800')
    expect(
      screen.getByRole('columnheader', { name: 'Input tokens' })
    ).toHaveClass('hidden', 'md:table-cell')
    expect(
      screen.getByRole('columnheader', { name: 'Total tokens' })
    ).not.toHaveClass('hidden')
  })

  it('shows a waiting podium and no rank when the day has no usage', () => {
    render(
      <UserRankingsBoard
        data={{
          ...fixture,
          rows: [],
          me: null,
          participants: 0,
          total_tokens: 0,
        }}
        signedIn
      />
    )
    expect(screen.getByText('The podium is waiting')).toBeVisible()
    expect(screen.getByText('Not ranked')).toBeVisible()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('does not invent silver or bronze winners when only one user is ranked', () => {
    render(
      <UserRankingsBoard
        data={{
          ...fixture,
          rows: fixture.rows.slice(0, 1),
          me: null,
          participants: 1,
        }}
        signedIn
      />
    )
    expect(screen.getByRole('article', { name: 'Gold' })).toBeVisible()
    expect(
      screen.queryByRole('article', { name: 'Silver' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('article', { name: 'Bronze' })
    ).not.toBeInTheDocument()
  })

  it('reveals remaining rows with the keyboard without changing their ranks', async () => {
    const user = userEvent.setup()
    const rows = Array.from({ length: 21 }, (_, index) => ({
      ...fixture.rows[0],
      rank: index + 1,
      name: `user-${index + 1}`,
    }))
    render(
      <UserRankingsBoard
        data={{ ...fixture, rows, participants: 21, me: null }}
        signedIn
      />
    )
    expect(
      within(screen.getByRole('table')).queryByText('user-21')
    ).not.toBeInTheDocument()
    screen.getByRole('button', { name: 'Show more' }).focus()
    await user.keyboard('{Enter}')
    expect(within(screen.getByRole('table')).getByText('user-21')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Show more' })
    ).not.toBeInTheDocument()
  })

  it('offers sign-in instead of displaying another user’s personal ranking', async () => {
    const router = createRouter({
      routeTree: createRootRoute({
        component: () => (
          <UserRankingsBoard data={{ ...fixture, me: null }} signedIn={false} />
        ),
      }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    })
    await router.load()
    render(<RouterProvider router={router} />)
    expect(
      await screen.findByRole('button', { name: 'Sign In' })
    ).toHaveAttribute('href', '/sign-in?redirect=%2Frankings')
    expect(screen.queryByText('#2')).not.toBeInTheDocument()
  })
})
