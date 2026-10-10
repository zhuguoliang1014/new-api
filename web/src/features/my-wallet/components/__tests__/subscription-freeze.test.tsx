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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { expect, it, vi } from 'vitest'

import type { SelfSubscriptionData } from '@/features/subscriptions/types'
import { api } from '@/lib/api'

import { MySubscriptionsCard } from '../my-subscriptions-card'

function renderSubscription(frozen: boolean, allowed: boolean, known = true) {
  const now = Math.floor(Date.now() / 1000)
  const data: SelfSubscriptionData = {
    billing_preference: 'subscription_first',
    subscriptions: [],
    all_subscriptions: [
      {
        plan_title: 'Pro',
        subscription: {
          id: 7,
          plan_id: 1,
          user_id: 1,
          status: frozen ? 'frozen' : 'active',
          start_time: now - 86400,
          end_time: now + 86400 * 29,
          frozen_at: frozen ? now - 3600 : 0,
          amount_total: 1000,
          amount_used: 250,
        },
      },
    ],
    freeze_policy: {
      allowed,
      calendar_available: known,
      date: '2026-10-10',
      server_time: now,
    },
  }
  if (!frozen) data.subscriptions = data.all_subscriptions
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: { success: true, data: url === '/api/subscription/self' ? data : [] },
  }))
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <MySubscriptionsCard />
    </QueryClientProvider>
  )
  return data
}

it('disables freezing when the server reports a non-holiday', async () => {
  const put = vi.spyOn(api, 'put')
  renderSubscription(false, false)
  const button = await screen.findByRole('button', { name: 'Freeze Pro' })
  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(put).not.toHaveBeenCalled()
})

it('freezes once, displays the frozen subscription, and exposes resume', async () => {
  const data = renderSubscription(false, true)
  let resolve: (response: unknown) => void = () => {}
  const put = vi.spyOn(api, 'put').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }) as ReturnType<typeof api.put>
  )
  const button = await screen.findByRole('button', { name: 'Freeze Pro' })
  await userEvent.click(button)
  expect(button).toBeDisabled()
  await userEvent.click(button)
  expect(put).toHaveBeenCalledOnce()
  expect(put).toHaveBeenCalledWith('/api/subscription/self/7/freeze', {
    frozen: true,
  })
  data.all_subscriptions[0].subscription.status = 'frozen'
  data.all_subscriptions[0].subscription.frozen_at =
    data.freeze_policy?.server_time ?? 0
  data.subscriptions = []
  resolve({
    data: { success: true, data: data.all_subscriptions[0].subscription },
  })
  expect(await screen.findByText('Frozen')).toBeVisible()
  expect(screen.getByText('1 frozen')).toBeVisible()
  expect(screen.queryByText('No Active')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Resume Pro' })).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: /Subscription History/ })
  ).not.toBeInTheDocument()
})

it.each([true, false])(
  'keeps resume available outside holidays even when calendar availability is %s',
  async (known) => {
    const data = renderSubscription(true, false, known)
    const put = vi.spyOn(api, 'put').mockImplementation(async () => {
      data.all_subscriptions[0].subscription.status = 'active'
      data.all_subscriptions[0].subscription.frozen_at = 0
      data.subscriptions = data.all_subscriptions
      return {
        data: { success: true, data: data.all_subscriptions[0].subscription },
      }
    })
    const button = await screen.findByRole('button', { name: 'Resume Pro' })
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(put).toHaveBeenCalledWith('/api/subscription/self/7/freeze', {
      frozen: false,
    })
    expect(
      await screen.findByRole('button', { name: 'Freeze Pro' })
    ).toBeDisabled()
  }
)

it('keeps frozen validity paused after the original end date passes', async () => {
  const data = renderSubscription(true, false)
  const sub = data.all_subscriptions[0].subscription
  sub.end_time = Math.floor(Date.now() / 1000) - 86400
  sub.frozen_at = sub.end_time - 29 * 86400
  expect(await screen.findByText('29 days remaining')).toBeVisible()
  expect(screen.getByText('Frozen')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Resume Pro' })).toBeEnabled()
})

it('retains the active state and shows the server rejection when freezing fails', async () => {
  renderSubscription(false, true)
  const error = vi.spyOn(toast, 'error').mockImplementation(() => 'error')
  vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: false, message: 'Today is not a public holiday.' },
  })
  await userEvent.click(
    await screen.findByRole('button', { name: 'Freeze Pro' })
  )
  await waitFor(() =>
    expect(error).toHaveBeenCalledWith('Today is not a public holiday.')
  )
  expect(screen.getByText('Active')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Freeze Pro' })).toBeEnabled()
})
