import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'

import { LocalSubscriptionPurchaseDialog } from '@/features/my-wallet/components/local-subscription-purchase-dialog'
import { api } from '@/lib/api'
import { formatCnyCurrencyAmount } from '@/lib/currency'

import {
  getPlanCreateFormSchema,
  createFormValuesToPayload,
  PLAN_CREATE_FORM_DEFAULTS,
  planToCreateFormValues,
} from '../../lib/plan-create-form'
import { getPromotionQuote } from '../../lib/promotion'
import { getPlanSalesState } from '../../lib/sales'
import { subscriptionPlanSchema, type PlanRecord } from '../../types'
import { SubscriptionCreateDrawer } from '../subscription-create-drawer'
import { SubscriptionsProvider } from '../subscriptions-provider'

afterEach(() => vi.useRealTimers())

function offer(): PlanRecord {
  return {
    plan: subscriptionPlanSchema.parse({
      ...createFormValuesToPayload(
        {
          ...PLAN_CREATE_FORM_DEFAULTS,
          title: 'GPT month',
          price_cny: 99,
          price_amount: 341.37931,
        },
        500000
      ).plan,
      id: 1,
      discount_rate: 0.8,
      discount_starts_at: 100,
      discount_ends_at: 200,
    }),
    regular_price_cny: 99,
    regular_price_amount: 341.37931,
  }
}

test('discount boundaries restore regular prices while keeping purchased quota and billing ratio', () => {
  const record = offer()
  for (const [now, price] of [
    [99, 99],
    [100, 79.2],
    [199, 79.2],
    [200, 99],
  ]) {
    const quote = getPromotionQuote(record, now)
    expect(quote.plan.price_cny).toBe(price)
    expect(quote.plan.total_amount).toBe(record.plan.total_amount)
    expect(quote.plan.billing_ratio).toBe(record.plan.billing_ratio)
  }
  expect(record.plan.price_cny).toBe(99)
})

test('promotion settings round-trip and invalid end times cannot submit', () => {
  const record = offer()
  const values = planToCreateFormValues(record.plan)
  expect(
    createFormValuesToPayload(values, 500000, record.plan).plan
  ).toMatchObject({
    discount_rate: 0.8,
    discount_starts_at: 100,
    discount_ends_at: 200,
  })
  const t = ((key: string) => key) as Parameters<
    typeof getPlanCreateFormSchema
  >[0]
  expect(
    getPlanCreateFormSchema(t).safeParse({ ...values, discount_ends_at: 0 })
      .success
  ).toBe(false)
  expect(
    getPlanCreateFormSchema(t).safeParse({ ...values, discount_rate: 0 })
      .success
  ).toBe(false)
  expect(
    getPlanCreateFormSchema(t).safeParse({ ...values, discount_rate: 1.01 })
      .success
  ).toBe(false)
})

test('a limited edition with no stock stays sold out until the administrator increases its cap', () => {
  const record = offer()
  record.plan.limited_sale = true
  record.plan.sales_limit = 0
  expect(getPlanSalesState(record).soldOut).toBe(true)
  record.plan.sales_limit = 5
  expect(getPlanSalesState(record).unavailable).toBe(false)
  record.paid_count = 5
  expect(getPlanSalesState(record).soldOut).toBe(true)
  record.plan.sales_limit = 6
  expect(getPlanSalesState(record).unavailable).toBe(false)
})

test('checkout restores the displayed regular price at the promotion end and submits that exact price', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(199000))
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValue({ data: { success: false, message: 'test' } })
  const view = render(
    <LocalSubscriptionPurchaseDialog
      open
      onOpenChange={() => {}}
      enableHupijiao
      plan={offer()}
    />
  )
  expect(
    screen.getAllByText(
      formatCnyCurrencyAmount(79.2, {
        digitsLarge: 2,
        digitsSmall: 2,
        abbreviate: false,
      })
    ).length
  ).toBeGreaterThan(0)
  await act(async () => {
    vi.advanceTimersByTime(1000)
  })
  expect(
    screen.getAllByText(
      formatCnyCurrencyAmount(99, {
        digitsLarge: 2,
        digitsSmall: 2,
        abbreviate: false,
      })
    ).length
  ).toBeGreaterThan(0)
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.click(screen.getByRole('button', { name: 'Alipay' }))
  expect(post).toHaveBeenCalledWith(
    '/api/subscription/hupijiao/pay',
    { plan_id: 1, expected_price_cny: 99 },
    { skipBusinessError: true }
  )
  view.unmount()
  vi.useRealTimers()
})

test('administrator sees discount controls and must supply an end time before saving', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } })
  const put = vi
    .spyOn(api, 'put')
    .mockResolvedValue({ data: { success: true } })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubscriptionsProvider>
        <SubscriptionCreateDrawer
          open
          onOpenChange={() => {}}
          currentRow={offer()}
        />
      </SubscriptionsProvider>
    </QueryClientProvider>
  )
  const rate = await screen.findByRole('spinbutton', { name: 'Discount rate' })
  expect(rate).toHaveValue(0.8)
  expect(screen.getByText('Discount end time')).toBeVisible()
  expect(
    screen.getByRole('switch', { name: 'Limited edition' })
  ).not.toBeChecked()
  await user.clear(rate)
  await user.type(rate, '0.75')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(put).toHaveBeenCalledWith(
    '/api/subscription/admin/plans/1',
    expect.objectContaining({
      plan: expect.objectContaining({
        discount_rate: 0.75,
        discount_ends_at: 200,
      }),
    })
  )
})

test('server-rounded discount prices win over browser rounding and restore at the boundary', () => {
  const record = offer()
  record.regular_price_cny = 1.005
  record.discount_price_cny = 0.81
  record.discount_price_amount = 273.103448
  expect(getPromotionQuote(record, 150).plan.price_cny).toBe(0.81)
  expect(getPromotionQuote(record, 150).plan.price_amount).toBe(273.103448)
  expect(getPromotionQuote(record, 200).plan.price_cny).toBe(1.005)
})
