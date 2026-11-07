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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { Finance } from '..'
import { financeCents, financeCSVHeader, parseFinanceCSV } from '../lib'
import type { FinanceReport } from '../types'

const report: FinanceReport = {
  categories: [
    {
      id: 1,
      code: 'upstream_credit',
      name: 'Upstream credit',
      enabled: true,
      built_in: true,
    },
  ],
  summary: {
    month: '2026-11',
    net_income_cents: 994,
    gross_income_cents: 1000,
    fee_cents: 6,
    expense_cents: 100,
    customer_refund_cents: 0,
    supplier_refund_cents: 0,
    fee_refund_cents: 0,
    balance_cents: 894,
    historical_net: false,
    estimated_fees: 1,
    unresolved: 0,
    count: 2,
    categories: { other: 100 },
  },
  months: [],
  periods: [],
  rules: [],
  synced_at: 1794000000,
}
const clients: QueryClient[] = []
const originalAnimations = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'getAnimations'
)
function renderFinance(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  render(
    <QueryClientProvider client={client}>
      <Finance />
    </QueryClientProvider>
  )
}
beforeEach(async () => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
  await i18next.changeLanguage('en')
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'finance-test', role: 100 })
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/report') ? report : { items: [], total: 0 },
    },
  }))
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { added: 0 } },
  })
})
afterEach(async () => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  useAuthStore.getState().auth.setUser(null)
  if (originalAnimations) {
    Object.defineProperty(
      Element.prototype,
      'getAnimations',
      originalAnimations
    )
  } else Reflect.deleteProperty(Element.prototype, 'getAnimations')
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
})

it('opens expense entry from the page and submits exact cents without crediting users', async () => {
  const user = userEvent.setup()
  const request = vi
    .spyOn(api, 'request')
    .mockResolvedValue({ data: { success: true, data: { id: 3 } } })
  renderFinance()
  await screen.findByRole('tab', { name: 'Monthly overview' })
  await user.click(screen.getByRole('button', { name: 'Record expense' }))
  const dialog = await screen.findByRole('dialog', { name: 'Expense' })
  await user.type(within(dialog).getByLabelText('Amount (CNY)'), '10.06')
  await user.type(
    within(dialog).getByLabelText('Payee or supplier'),
    'Test supplier'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/api/finance/entries',
        data: expect.objectContaining({
          amount_cents: 1006,
          kind: 'expense',
          payer: '国良',
        }),
      })
    )
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
})

it('records a WeChat receipt with its own zero fee rather than the Alipay rate', async () => {
  const user = userEvent.setup()
  const request = vi
    .spyOn(api, 'request')
    .mockResolvedValue({ data: { success: true, data: { id: 4 } } })
  renderFinance()
  await user.click(await screen.findByRole('tab', { name: 'Income records' }))
  await user.click(
    screen.getByRole('button', { name: 'Record WeChat receipt' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Income',
  })
  expect(
    within(dialog).getByText(
      'Record offline WeChat payments only. This does not credit a user balance.'
    )
  ).toBeVisible()
  await user.type(within(dialog).getByLabelText('Amount (CNY)'), '10')
  await user.type(
    within(dialog).getByLabelText('Notes'),
    'WeChat receipt proof'
  )
  await user.click(within(dialog).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount_cents: 1000,
          fee_cents: 0,
          method: 'wechat_offline',
        }),
      })
    )
  )
})

it('adds a custom expense category and offers exactly the two authorized payers', async () => {
  const user = userEvent.setup()
  let currentReport = report
  vi.mocked(api.get).mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url.endsWith('/report') ? currentReport : { items: [], total: 0 },
    },
  }))
  const request = vi.spyOn(api, 'request').mockImplementation(async () => {
    currentReport = {
      ...report,
      categories: [
        ...report.categories,
        {
          id: 9,
          code: 'custom:test',
          name: '财务软件',
          enabled: true,
          built_in: false,
        },
      ],
    }
    return { data: { success: true, data: null } }
  })
  renderFinance()
  await user.click(await screen.findByRole('tab', { name: 'Financial rules' }))
  await user.type(screen.getByLabelText('Category name'), '财务软件')
  await user.click(screen.getByRole('button', { name: 'Add category' }))
  await screen.findByText('财务软件')
  expect(request).toHaveBeenCalledWith(
    expect.objectContaining({
      url: '/api/finance/categories',
      data: { name: '财务软件', enabled: true },
    })
  )
  await user.click(screen.getByRole('button', { name: 'Record expense' }))
  const dialog = await screen.findByRole('dialog', { name: 'Expense' })
  expect(
    within(dialog).getByRole('option', { name: 'Xiqiang' })
  ).toHaveAttribute('value', '西强')
  expect(
    within(dialog).getByRole('option', { name: 'Guoliang' })
  ).toHaveAttribute('value', '国良')
  await user.selectOptions(
    within(dialog).getByLabelText('Category'),
    'custom:test'
  )
  expect(within(dialog).getByLabelText('Category')).toHaveValue('custom:test')
})

it('does not fetch financial data for an unauthorized administrator', () => {
  useAuthStore
    .getState()
    .auth.setUser({ id: 2, username: 'ordinary-admin', role: 10 })
  renderFinance()
  expect(screen.getByText('Access denied')).toBeInTheDocument()
  expect(api.get).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
})

it('allows a finance reader to view data while hiding writing and export controls', async () => {
  useAuthStore.getState().auth.setUser({
    id: 2,
    username: 'reader',
    role: 10,
    permissions: { admin_permissions: { finance: { read: true } } },
  })
  renderFinance()
  await screen.findByRole('tab', { name: 'Monthly overview' })
  expect(
    screen.queryByRole('button', { name: 'Record expense' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Export CSV' })
  ).not.toBeInTheDocument()
})

it('shows incomplete totals when income synchronization fails', async () => {
  vi.mocked(api.post).mockRejectedValue(new Error('offline'))
  renderFinance()
  expect(
    await screen.findByText(
      'Income synchronization failed. Displayed records may be incomplete; retry before relying on totals.'
    )
  ).toBeVisible()
})

it('updates financial headings and actions after switching to Chinese', async () => {
  i18next.addResourceBundle('zh', 'translation', zh.translation)
  renderFinance()
  await screen.findByRole('tab', { name: 'Monthly overview' })
  await act(() => i18next.changeLanguage('zh'))
  expect(screen.getByRole('button', { name: '记一笔支出' })).toBeVisible()
  expect(screen.getByRole('tab', { name: '月度总览' })).toBeVisible()
})

it('parses quoted historical rows and preserves net income without inventing fees or dates', () => {
  const rows = parseFinanceCSV(
    `${financeCSVHeader}\r\nhistorical_income,2026-10,,5270,,,,,"net, already after fees",sheet:income:10\r\nexpense,2026-10,,18.57,proxy,supplier,gl,alipay,"two\nlines",sheet:317`
  )
  expect(rows[0]).toMatchObject({
    kind: 'historical_income',
    amount_cents: 527000,
    fee_cents: null,
    date: '',
  })
  expect(rows[1]).toMatchObject({
    amount_cents: 1857,
    note: 'two\nlines',
    source_ref: 'sheet:317',
  })
  expect(() =>
    parseFinanceCSV(
      `${financeCSVHeader}\nexpense,2026-10,,0.001,other,supplier,gl,alipay,note,1`
    )
  ).toThrow()
  expect(() => parseFinanceCSV(`${financeCSVHeader}\n"unclosed`)).toThrow()
  expect(financeCents('10.06')).toBe(1006)
  expect(financeCents('1e5')).toBeNull()
})
