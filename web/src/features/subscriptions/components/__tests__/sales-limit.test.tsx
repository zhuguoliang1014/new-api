import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { expect, test, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { LocalSubscriptionPurchaseDialog } from '@/features/my-wallet/components/local-subscription-purchase-dialog'
import { SubscriptionPlansCard } from '@/features/wallet/components/subscription-plans-card'
import { api } from '@/lib/api'

import {
  createFormValuesToPayload,
  PLAN_CREATE_FORM_DEFAULTS,
} from '../../lib/plan-create-form'
import { getPlanSalesState } from '../../lib/sales'
import { subscriptionPlanSchema, type PlanRecord } from '../../types'
import { SubscriptionPurchaseDialog } from '../dialogs/subscription-purchase-dialog'
import { PlanSalesStatus } from '../plan-sales-status'
import { SubscriptionCreateDrawer } from '../subscription-create-drawer'
import { SubscriptionsProvider } from '../subscriptions-provider'

function record(paid: number, reserved = 0): PlanRecord {
  return {
    plan: subscriptionPlanSchema.parse({
      ...createFormValuesToPayload(
        {
          ...PLAN_CREATE_FORM_DEFAULTS,
          title: 'Limited plan',
          price_amount: 1,
          price_cny: 7,
          sales_limit: 30,
        },
        500000
      ).plan,
      id: 1,
      stripe_price_id: 'price_test',
      creem_product_id: 'prod_test',
      waffo_pancake_product_id: 'waffo_test',
    }),
    paid_count: paid,
    reserved_count: reserved,
    remaining_count: Math.max(0, 30 - paid - reserved),
    sold_out: paid >= 30,
    sales_unavailable: paid + reserved >= 30,
  }
}

test.each([
  [0, 0, 3, false, false],
  [2, 1, 0, false, true],
  [3, 0, 0, true, true],
])(
  'counts two display sales with %i paid and %i reserved orders',
  (paid, reserved, remaining, soldOut, unavailable) => {
    const offer = record(paid, reserved)
    offer.plan.sales_limit = 5
    offer.plan.display_sold_count = 2
    delete offer.remaining_count
    delete offer.sold_out
    delete offer.sales_unavailable
    expect(getPlanSalesState(offer)).toMatchObject({
      remaining,
      soldOut,
      unavailable,
    })
  }
)

test('display sales exhaust all limited places and disable payment without creating paid orders', () => {
  const offer = record(0)
  offer.plan.sales_limit = 5
  offer.plan.display_sold_count = 5
  delete offer.remaining_count
  render(
    <LocalSubscriptionPurchaseDialog
      open
      onOpenChange={() => {}}
      enableHupijiao
      plan={offer}
    />
  )
  expect(screen.getByRole('button', { name: 'Alipay' })).toBeDisabled()
  expect(screen.getByText('Sold Out')).toBeVisible()
})

test('a sold-out plan disables every built-in payment method in the purchase dialog', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubscriptionPurchaseDialog
        open
        onOpenChange={() => {}}
        plan={record(30)}
        enableStripe
        enableCreem
        enableWaffoPancake
        enableOnlineTopUp
        epayMethods={[{ type: 'alipay', name: 'Alipay' }]}
        userQuota={1000000}
      />
    </QueryClientProvider>
  )
  for (const name of [
    'Pay with Balance',
    'Stripe',
    'Creem',
    'Waffo Pancake',
    'Pay',
  ]) {
    expect(screen.getByRole('button', { name })).toBeDisabled()
  }
  expect(screen.getByText('Sold Out')).toBeVisible()
})

test('a local payment dialog blocks reserved stock and re-enables checkout when stock returns', () => {
  const props = { open: true, onOpenChange: () => {}, enableHupijiao: true }
  const view = render(
    <LocalSubscriptionPurchaseDialog {...props} plan={record(29, 1)} />
  )
  expect(screen.getByRole('button', { name: 'Alipay' })).toBeDisabled()
  expect(screen.getByText('Places reserved')).toBeVisible()
  view.rerender(
    <LocalSubscriptionPurchaseDialog {...props} plan={record(29)} />
  )
  expect(screen.getByRole('button', { name: 'Alipay' })).toBeEnabled()
})

test('the legacy wallet refreshes sold-out stock and keeps checkout disabled after refreshing', async () => {
  let current = record(29)
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/subscription/plans') {
      return { data: { success: true, data: [current] } }
    }
    return {
      data: {
        success: true,
        data: { subscriptions: [], all_subscriptions: [] },
      },
    }
  })
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <SubscriptionPlansCard topupInfo={null} />
      </TooltipProvider>
    </QueryClientProvider>
  )
  expect(
    await screen.findByRole('button', { name: 'Subscribe Now' })
  ).toBeEnabled()
  current = record(30)
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(await screen.findByRole('button', { name: 'Sold Out' })).toBeDisabled()
  expect(
    screen.queryByRole('button', { name: 'Subscribe Now' })
  ).not.toBeInTheDocument()
})

test('the editor reports a rejected sales cap and keeps the unsaved form open', async () => {
  const message =
    'Sales limit cannot be less than paid, reserved and display sales'
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: [] } })
  vi.spyOn(api, 'put').mockResolvedValue({
    data: { success: false, message, message_key: message },
  })
  const error = vi.spyOn(toast, 'error')
  const close = vi.fn()
  const user = userEvent.setup()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SubscriptionsProvider>
        <SubscriptionCreateDrawer
          open
          onOpenChange={close}
          currentRow={record(29)}
        />
      </SubscriptionsProvider>
    </QueryClientProvider>
  )
  const input = await screen.findByRole('spinbutton', {
    name: 'Total Sales Limit',
  })
  expect(
    screen.getByText(
      'For limited editions, 0 means no stock. Paid orders, pending payments and display sales count toward the total.'
    )
  ).toBeVisible()
  await user.clear(input)
  await user.type(input, '1')
  await user.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(error).toHaveBeenCalledWith(message)
  expect(input).toHaveValue(1)
  expect(close).not.toHaveBeenCalled()
})

test('limited stock explains the difference between paid sales and remaining places', () => {
  const offer = record(6, 1)
  offer.plan.sales_limit = 20
  offer.remaining_count = 13
  render(<PlanSalesStatus record={offer} />)
  expect(
    screen.getByText('Limited to 20 · 13 available', { exact: false })
  ).toBeVisible()
  expect(screen.getByText('Payment reservations: 1')).toBeVisible()
})

test('zero reservations do not add an unnecessary inventory label', () => {
  render(<PlanSalesStatus record={record(6)} />)
  expect(screen.queryByText(/Payment reservations:/)).not.toBeInTheDocument()
})
