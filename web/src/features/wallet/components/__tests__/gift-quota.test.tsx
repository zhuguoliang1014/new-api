import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import * as usersApi from '@/features/users/api'
import { UserQuotaDialog } from '@/features/users/components/user-quota-dialog'
import zh from '@/i18n/locales/zh.json'
import { formatQuota, formatTimestamp } from '@/lib/format'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { WalletStatsCard } from '../wallet-stats-card'

const clients: QueryClient[] = []
function provider(children: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

afterEach(async () => {
  clients.splice(0).forEach((client) => client.clear())
  await i18next.changeLanguage('en')
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

const nextExpiry = 1796592000

it('shows purchased and gift balances separately and switches language', async () => {
  provider(
    <WalletStatsCard
      user={{
        id: 7,
        username: 'wallet-user',
        aff_count: 0,
        group: 'default',
        quota: 2000000,
        balance_quota: 1500000,
        gift_quota: 500000,
        next_gift_expiry: nextExpiry,
        used_quota: 0,
        request_count: 3,
        aff_quota: 0,
        aff_history_quota: 0,
      }}
    />
  )
  expect(screen.getByText('Account balance')).toBeVisible()
  expect(screen.getByText('Gift balance')).toBeVisible()
  expect(screen.getByText(formatQuota(1500000))).toBeVisible()
  expect(screen.getByText(formatQuota(500000))).toBeVisible()
  expect(screen.queryByText(formatQuota(2000000))).not.toBeInTheDocument()
  i18next.addResourceBundle('zhCN', 'translation', zh.translation)
  await i18next.changeLanguage('zhCN')
  expect(await screen.findByText('账户余额')).toBeVisible()
  expect(screen.getByText('赠送余额')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: '赠送额度记录' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(
      zh.translation[
        'Gift credits are used first and expire 30 days after grant. Purchased balance never expires.'
      ]
    )
  ).not.toBeInTheDocument()
  const trigger = screen.getByRole('button', { name: '赠送余额' })
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  expect(
    await screen.findByText(
      zh.translation[
        'Gift credits are used first and expire 30 days after grant. Purchased balance never expires.'
      ]
    )
  ).toBeVisible()
  expect(screen.getByText('最近一笔到期时间')).toBeVisible()
  expect(screen.getByText(formatTimestamp(nextExpiry))).toBeVisible()
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await userEvent.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
})

it('defaults administrator grants to gifts and sends the explicit quota type', async () => {
  const adjust = vi
    .spyOn(usersApi, 'adjustUserQuota')
    .mockResolvedValue({ success: true })
  render(
    <UserQuotaDialog
      open
      onOpenChange={vi.fn()}
      userId={7}
      currentQuota={1000000}
      onSuccess={vi.fn()}
    />
  )
  expect(screen.getByRole('button', { name: 'Gift balance' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.getByRole('button', { name: 'Subtract' })).toBeDisabled()
  await userEvent.type(screen.getByRole('spinbutton'), '5')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(adjust).toHaveBeenCalledWith({
      id: 7,
      action: 'add_quota',
      quota_type: 'gift',
      mode: 'add',
      value: 2500000,
    })
  )
})

it('lets administrators choose permanent balance for purchased funds', async () => {
  const adjust = vi
    .spyOn(usersApi, 'adjustUserQuota')
    .mockResolvedValue({ success: true })
  render(
    <UserQuotaDialog
      open
      onOpenChange={vi.fn()}
      userId={7}
      currentQuota={1000000}
      onSuccess={vi.fn()}
    />
  )
  await userEvent.click(screen.getByRole('button', { name: 'Account balance' }))
  expect(screen.getByRole('button', { name: 'Subtract' })).toBeEnabled()
  await userEvent.type(screen.getByRole('spinbutton'), '10')
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(adjust).toHaveBeenCalledWith({
      id: 7,
      action: 'add_quota',
      quota_type: 'balance',
      mode: 'add',
      value: 5000000,
    })
  )
})
