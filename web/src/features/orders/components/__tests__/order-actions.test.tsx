import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import * as apiLib from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { BillingHistoryList } from '../billing-history-list'

const originalAnimations = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'getAnimations'
)
let status = 'pending'
let client: QueryClient
const order = {
  id: 1,
  user_id: 1,
  trade_no: 'test-order',
  payment_provider: 'hupijiao',
  payment_method: 'alipay',
  money: 20,
  amount: 20,
  create_time: 1792129000,
}

beforeEach(async () => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 10 })
  status = 'pending'
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  i18next.addResourceBundle('zh', 'translation', zh.translation)
  await i18next.changeLanguage('zh')
  vi.spyOn(apiLib, 'getSelf').mockResolvedValue({})
  vi.spyOn(api, 'get').mockImplementation(async () => ({
    data: { success: true, data: { items: [{ ...order, status }], total: 1 } },
  }))
})

afterEach(async () => {
  vi.useRealTimers()
  if (originalAnimations) {
    Object.defineProperty(
      Element.prototype,
      'getAnimations',
      originalAnimations
    )
  } else {
    Reflect.deleteProperty(Element.prototype, 'getAnimations')
  }
  client.clear()
  useAuthStore.getState().auth.reset()
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
})

it('shows Chinese statuses and only grants the admin settlement action after provider verification succeeds', async () => {
  const post = vi.spyOn(api, 'post').mockImplementation(async () => {
    status = 'success'
    return { data: { success: true, data: { status } } }
  })
  render(
    <QueryClientProvider client={client}>
      <BillingHistoryList />
    </QueryClientProvider>
  )
  expect(await screen.findByText('待支付')).toBeInTheDocument()
  expect(screen.queryByText('Pending')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: '去支付' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '核实并补单' }))
  const dialog = screen.getByRole('alertdialog')
  expect(
    within(dialog).getByText('确认支付平台已收款后，才会补发额度或套餐。')
  ).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: '核实并补单' }))
  expect(await screen.findByText('已支付')).toBeInTheDocument()
  expect(post).toHaveBeenCalledWith('/api/user/topup/complete', {
    trade_no: 'test-order',
  })
})

it('keeps an unpaid order unchanged when the platform refuses settlement', async () => {
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: false, message: '支付平台尚未确认付款，不能补单' },
  })
  render(
    <QueryClientProvider client={client}>
      <BillingHistoryList />
    </QueryClientProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: '核实并补单' }))
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: '核实并补单',
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  )
  expect(screen.getByText('待支付')).toBeInTheDocument()
  expect(screen.queryByText('已支付')).not.toBeInTheDocument()
})

it('cancels a personal order and synchronizes both the personal and admin lists', async () => {
  const remove = vi.spyOn(api, 'delete').mockImplementation(async () => {
    status = 'canceled'
    return { data: { success: true, data: { status } } }
  })
  render(
    <QueryClientProvider client={client}>
      <section aria-label='admin'>
        <BillingHistoryList />
      </section>
      <section aria-label='personal'>
        <BillingHistoryList userOnly />
      </section>
    </QueryClientProvider>
  )
  const personal = within(screen.getByRole('region', { name: 'personal' }))
  expect(await personal.findByRole('button', { name: '去支付' })).toBeEnabled()
  expect(
    personal.queryByRole('button', { name: '核实并补单' })
  ).not.toBeInTheDocument()
  fireEvent.click(personal.getByRole('button', { name: '取消订单' }))
  fireEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', {
      name: '确认',
    })
  )
  await waitFor(() => expect(screen.getAllByText('已取消')).toHaveLength(2))
  expect(remove).toHaveBeenCalledWith('/api/user/topup/test-order')
  expect(
    screen.queryByRole('button', { name: '去支付' })
  ).not.toBeInTheDocument()
})

it('opens the existing payment dialog when the owner resumes an unpaid order', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'user', role: 1 })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: {
      success: true,
      data: {
        trade_no: 'resumed-order',
        pay_url: 'https://pay.example/resume',
      },
    },
  })
  render(
    <QueryClientProvider client={client}>
      <BillingHistoryList userOnly />
    </QueryClientProvider>
  )
  fireEvent.click(await screen.findByRole('button', { name: '去支付' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(post).toHaveBeenCalledWith('/api/user/topup/test-order/repay')
  expect(
    screen.queryByRole('button', { name: '核实并补单' })
  ).not.toBeInTheDocument()
})

it('refreshes status from the server without manual refresh and translates canceled and expired states', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  render(
    <QueryClientProvider client={client}>
      <BillingHistoryList userOnly />
    </QueryClientProvider>
  )
  expect(await screen.findByText('待支付')).toBeInTheDocument()
  status = 'expired'
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000)
  })
  expect(await screen.findByText('已过期')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '去支付' })).toBeEnabled()
})
