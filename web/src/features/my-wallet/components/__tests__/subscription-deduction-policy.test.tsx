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
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'

import type { SelfSubscriptionData } from '@/features/subscriptions/types'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { MySubscriptionsCard } from '../my-subscriptions-card'

afterEach(async () => {
  await i18next.changeLanguage('en')
})

function renderSubscriptions(preference = 'subscription_first', count = 0) {
  const now = Math.floor(Date.now() / 1000)
  const data: SelfSubscriptionData = {
    billing_preference: preference,
    subscriptions: Array.from({ length: count }, (_, i) => ({
      plan_title: `Plan ${i + 1}`,
      subscription: {
        id: i + 1,
        plan_id: i + 1,
        user_id: 1,
        status: 'active',
        start_time: now - 60,
        end_time: now + 86400 * (count - i),
        amount_total: 1000,
        amount_used: 0,
        user_priority: 0,
      },
    })),
    all_subscriptions: [],
  }
  data.all_subscriptions = data.subscriptions
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: { success: true, data: url === '/api/subscription/self' ? data : [] },
  }))
  const view = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <MySubscriptionsCard />
    </QueryClientProvider>
  )
  return { data, ...view }
}

test.each([
  {
    language: 'en',
    expected: 'Subscription first',
    empty: 'No subscription records',
  },
  { language: 'zh', expected: '订阅优先', empty: '暂无订阅记录' },
])(
  'exposes billing preference even without subscriptions in $language',
  async ({ language, expected, empty }) => {
    i18next.addResourceBundle('zh', 'translation', zh.translation)
    await i18next.changeLanguage(language)
    renderSubscriptions('subscription_only')
    expect(await screen.findByRole('radio', { name: expected })).toBeChecked()
    expect(screen.getByText(empty)).toBeVisible()
  }
)

test('saves wallet first once, disables controls while saving, and reloads the saved choice', async () => {
  const { data, unmount } = renderSubscriptions('subscription_first', 1)
  let resolve!: (value: unknown) => void
  const put = vi.spyOn(api, 'put').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }) as ReturnType<typeof api.put>
  )
  const wallet = await screen.findByRole('radio', { name: 'Wallet first' })
  await userEvent.click(wallet)
  expect(put).toHaveBeenCalledExactlyOnceWith(
    '/api/subscription/self/preference',
    { billing_preference: 'wallet_first' }
  )
  expect(wallet).toHaveAttribute('aria-disabled', 'true')
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  data.billing_preference = 'wallet_first'
  await act(async () =>
    resolve({
      data: { success: true, data: { billing_preference: 'wallet_first' } },
    })
  )
  expect(wallet).toBeChecked()
  unmount()
  renderSubscriptions('wallet_first', 1)
  expect(
    await screen.findByRole('radio', { name: 'Wallet first' })
  ).toBeChecked()
})

test.each(['business', 'network'])(
  'keeps the saved preference after a %s failure',
  async (failure) => {
    renderSubscriptions('wallet_first')
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 'error')
    const put = vi.spyOn(api, 'put')
    if (failure === 'business') {
      put.mockResolvedValue({
        data: { success: false, message: 'Preference rejected' },
      })
    } else {
      put.mockRejectedValue(new Error('Network unavailable'))
    }
    await userEvent.click(
      await screen.findByRole('radio', { name: 'Subscription first' })
    )
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(screen.getByRole('radio', { name: 'Wallet first' })).toBeChecked()
    expect(
      screen.getByRole('radio', { name: 'Subscription first' })
    ).not.toHaveAttribute('aria-disabled', 'true')
  }
)

test('saves keyboard ordering once, disables conflicting changes, and reloads the persisted order', async () => {
  let resolve!: (value: unknown) => void
  const put = vi.spyOn(api, 'put').mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      }) as ReturnType<typeof api.put>
  )
  const { data } = renderSubscriptions('subscription_first', 2)
  const list = await screen.findByRole('list', {
    name: 'Subscription deduction order',
  })
  const rows = within(list).getAllByRole('listitem')
  expect(within(rows[0]).getByText('Plan 2')).toBeVisible()
  expect(within(rows[1]).getByText('Plan 1')).toBeVisible()
  expect(
    within(rows[0]).getByRole('button', { name: 'Move Plan 2 up' })
  ).toBeDisabled()
  within(rows[1]).getByRole('button', { name: 'Move Plan 1 up' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(put).toHaveBeenCalledExactlyOnceWith(
    '/api/subscription/self/priority',
    {
      items: [
        { id: 1, priority: 2 },
        { id: 2, priority: 1 },
      ],
    }
  )
  for (const button of within(list).getAllByRole('button')) {
    expect(button).toBeDisabled()
  }
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Manage subscriptions' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Wallet first' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  data.subscriptions[0].subscription.user_priority = 2
  data.subscriptions[1].subscription.user_priority = 1
  await act(async () => resolve({ data: { success: true } }))
  expect(
    within(within(list).getAllByRole('listitem')[0]).getByText('Plan 1')
  ).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  )
  expect(
    within(within(list).getAllByRole('listitem')[0]).getByText('Plan 1')
  ).toBeVisible()
})

test('restores the persisted deduction order when saving fails and allows retry', async () => {
  const error = vi.spyOn(toast, 'error').mockImplementation(() => 'error')
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: false, message: 'Order rejected' } })
  renderSubscriptions('wallet_first', 2)
  const move = await screen.findByRole('button', { name: 'Move Plan 1 up' })
  await userEvent.click(move)
  await waitFor(() => expect(error).toHaveBeenCalledWith('Order rejected'))
  const list = screen.getByRole('list', {
    name: 'Subscription deduction order',
  })
  expect(
    within(within(list).getAllByRole('listitem')[0]).getByText('Plan 2')
  ).toBeVisible()
  expect(move).toBeEnabled()
  put.mockResolvedValue({ data: { success: true } })
  await userEvent.click(move)
  await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
})
