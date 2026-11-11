import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'
import { formatCnyCurrencyAmount } from '@/lib/currency'

import {
  createFormValuesToPayload,
  PLAN_CREATE_FORM_DEFAULTS,
  planToCreateFormValues,
} from '../../lib'
import { calculatePlanQuotaUSD } from '../../lib/plan-pricing'
import { subscriptionPlanSchema, type PlanRecord } from '../../types'
import { SubscriptionCreateDrawer } from '../subscription-create-drawer'
import { SubscriptionsProvider } from '../subscriptions-provider'

function renderEditor(record?: PlanRecord) {
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } })
  const save = vi
    .spyOn(api, record ? 'put' : 'post')
    .mockResolvedValue({ data: { success: true } })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubscriptionsProvider>
        <SubscriptionCreateDrawer
          open
          onOpenChange={() => {}}
          currentRow={record}
        />
      </SubscriptionsProvider>
    </QueryClientProvider>
  )
  return save
}

test('new plan starts unpublished, has a clear four-section flow and hides advanced controls', () => {
  renderEditor()
  expect(screen.getByRole('switch', { name: 'Publish plan' })).not.toBeChecked()
  const headings = screen
    .getAllByRole('heading', { level: 3 })
    .map((node) => node.textContent)
  expect(headings).toEqual([
    'Basic Info',
    'Regular pricing',
    'Scheduled price discount',
    'Sales & inventory',
  ])
  expect(
    screen.getByRole('spinbutton', { name: 'Regular price (CNY)' })
  ).toBeVisible()
  expect(
    screen.getByRole('spinbutton', { name: 'Regular effective multiplier' })
  ).toHaveValue(0.29)
  expect(
    screen.queryByRole('spinbutton', { name: 'Plan billing multiplier' })
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Discount end time')).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: /Advanced Settings/ })
  ).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('button', { name: /Advanced Settings/ })).toHaveClass(
    'whitespace-normal'
  )
})

test('entering price and multiplier calculates quota while an activity only changes the purchase price', async () => {
  const save = renderEditor()
  const user = userEvent.setup()
  await user.type(
    screen.getByRole('textbox', { name: 'Plan Title' }),
    'Test month'
  )
  const price = screen.getByRole('spinbutton', { name: 'Regular price (CNY)' })
  await user.clear(price)
  await user.type(price, '99')
  const multiplier = screen.getByRole('spinbutton', {
    name: 'Regular effective multiplier',
  })
  await user.clear(multiplier)
  await user.type(multiplier, '0.28')
  expect(screen.getByText('$353.57')).toBeVisible()
  const discount = screen.getByRole('spinbutton', { name: 'Discount rate' })
  await user.clear(discount)
  await user.type(discount, '0.8')
  expect(screen.getByText('Discount end time')).toBeVisible()
  expect(screen.getByText('$353.57')).toBeVisible()
  expect(
    screen.getByText(
      formatCnyCurrencyAmount(79.2, {
        digitsLarge: 2,
        digitsSmall: 2,
        abbreviate: false,
      })
    )
  ).toBeVisible()
  // The required promotion end date is checked even when the user omits it.
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(
    await screen.findByText('Discount end time must be later than start time')
  ).toBeVisible()
  expect(save).not.toHaveBeenCalled()
  await user.clear(discount)
  await user.type(discount, '1')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      '/api/subscription/admin/plans',
      expect.objectContaining({
        plan: expect.objectContaining({
          enabled: false,
          price_cny: 99,
          price_amount: 353.571428,
          total_amount: 176785714,
          allowed_channel_types: '1',
          duration_unit: 'month',
          duration_value: 1,
          discount_rate: 1,
          minimum_effective_ratio: 0.18,
        }),
      })
    )
  )
})

test('editing only a promotion does not rewrite a legacy custom quota or payment options', () => {
  const plan = subscriptionPlanSchema.parse({
    ...createFormValuesToPayload(
      {
        ...PLAN_CREATE_FORM_DEFAULTS,
        title: 'Legacy',
        price_amount: 1155,
        price_cny: 300,
      },
      500000
    ).plan,
    id: 12,
    total_amount: 575000001,
    allow_balance_pay: false,
    allow_wallet_overflow: false,
    waffo_pancake_product_id: 'original-product',
    downgrade_group: 'original-group',
  })
  const values = planToCreateFormValues(plan)
  const payload = createFormValuesToPayload(
    { ...values, discount_rate: 0.8, discount_ends_at: 200 },
    500000,
    plan
  )
  expect(payload.plan).toMatchObject({
    total_amount: 575000001,
    price_amount: 1155,
    waffo_pancake_product_id: 'original-product',
    allow_balance_pay: false,
    allow_wallet_overflow: false,
    downgrade_group: 'original-group',
  })
})

test('automatic quota rounds down and never sells below the requested effective multiplier', () => {
  for (const [price, ratio] of [
    [49, 0.29],
    [99, 0.28],
    [199, 0.27],
    [399, 0.26],
    [999, 0.23],
  ]) {
    const quota = calculatePlanQuotaUSD(price, ratio)
    expect(price / quota).toBeGreaterThanOrEqual(ratio)
    expect(price / quota - ratio).toBeLessThan(0.000001)
  }
  expect(calculatePlanQuotaUSD(0, 0.29)).toBe(0)
  expect(calculatePlanQuotaUSD(99, 0)).toBe(0)
})

test('turning off limited edition removes the old cap and keeps publication unchanged', async () => {
  const plan = subscriptionPlanSchema.parse({
    ...createFormValuesToPayload(
      {
        ...PLAN_CREATE_FORM_DEFAULTS,
        title: 'Limited draft',
        price_cny: 99,
        price_amount: 100,
        limited_sale: true,
        sales_limit: 5,
        enabled: false,
      },
      500000
    ).plan,
    id: 4,
  })
  const save = renderEditor({ plan })
  const user = userEvent.setup()
  expect(
    screen.getByRole('spinbutton', { name: 'Total Sales Limit' })
  ).toHaveValue(5)
  await user.click(screen.getByRole('switch', { name: 'Limited edition' }))
  expect(
    screen.queryByRole('spinbutton', { name: 'Total Sales Limit' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      '/api/subscription/admin/plans/4',
      expect.objectContaining({
        plan: expect.objectContaining({
          limited_sale: false,
          sales_limit: 0,
          enabled: false,
        }),
      })
    )
  )
})

test('a hidden advanced validation error opens advanced settings instead of blocking silently', async () => {
  const plan = subscriptionPlanSchema.parse({
    ...createFormValuesToPayload(
      {
        ...PLAN_CREATE_FORM_DEFAULTS,
        title: 'Invalid legacy',
        price_cny: 99,
        price_amount: 100,
        billing_ratio: 0,
      },
      500000
    ).plan,
    id: 8,
  })
  const save = renderEditor({ plan })
  const user = userEvent.setup()
  expect(
    screen.queryByRole('spinbutton', { name: 'Plan billing multiplier' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(
    await screen.findByRole('spinbutton', { name: 'Plan billing multiplier' })
  ).toBeVisible()
  expect(
    screen.getByText('Billing multiplier must be greater than zero')
  ).toBeVisible()
  expect(save).not.toHaveBeenCalled()
})

// Exercise native constraint validation, which can block submit before Zod or
// onSubmit runs. Decimal floors must not be offset by the HTML minimum.
test.each([0.17, 0.18, 0.180001, 0.181333, 0.23])(
  'a minimum effective multiplier of %s passes native validation and saves unchanged',
  async (minimum) => {
    const plan = subscriptionPlanSchema.parse({
      ...createFormValuesToPayload(
        {
          ...PLAN_CREATE_FORM_DEFAULTS,
          title: 'Custom star month',
          price_cny: 1360,
          price_amount: 6000,
          allowed_channel_types: [1],
          minimum_effective_ratio: 0.18,
          discount_rate: 0.8,
          discount_ends_at: Math.floor(Date.now() / 1000) + 3600,
        },
        500000
      ).plan,
      id: 47,
    })
    const save = renderEditor({ plan })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /Advanced Settings/ }))
    const input = screen.getByRole('spinbutton', {
      name: 'Minimum effective multiplier',
    }) as HTMLInputElement
    await user.clear(input)
    await user.type(input, String(minimum))
    expect(input.validity.stepMismatch).toBe(false)
    expect(input.checkValidity()).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        '/api/subscription/admin/plans/47',
        expect.objectContaining({
          plan: expect.objectContaining({
            price_cny: 1360,
            price_amount: 6000,
            total_amount: 3000000000,
            discount_rate: 0.8,
            minimum_effective_ratio: minimum,
          }),
        })
      )
    )
  }
)
