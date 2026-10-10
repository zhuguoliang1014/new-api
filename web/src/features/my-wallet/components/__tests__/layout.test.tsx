import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'
import { api } from '@/lib/api'

import { RechargeTab } from '../recharge-tab'
import { SubscriptionTab } from '../subscription-tab'

const rechargeProps = {
  hupijiaoEnabled: true,
  presetAmounts: [{ value: 100, discount: 1 }],
  selectedPreset: 100,
  onSelectPreset: vi.fn(),
  topupAmount: 100,
  onTopupAmountChange: vi.fn(),
  paymentAmount: 700,
  calculating: false,
  minTopup: 1,
  priceRatio: 7,
  paymentLoading: null,
  onAlipayClick: vi.fn(),
  redemptionCode: '',
  onRedemptionCodeChange: vi.fn(),
  onRedeem: vi.fn(),
  redeeming: false,
  redemptionEnabled: true,
}

function subscription(id: number): UserSubscriptionRecord {
  return {
    plan_title: `Plan ${id}`,
    subscription: {
      id,
      user_id: 1,
      plan_id: id,
      status: 'active',
      start_time: Math.floor(Date.now() / 1000) - 100,
      end_time: Math.floor(Date.now() / 1000) + 86400 * 30,
      amount_total: 500000000,
      amount_used: 500000,
      user_priority: 10 - id,
    },
  }
}

async function renderSubscriptions(records: UserSubscriptionRecord[]) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data:
        url === '/api/subscription/self'
          ? { subscriptions: records, all_subscriptions: records }
          : [],
    },
  }))
  const result = render(
    <TooltipProvider>
      <SubscriptionTab topupInfo={null} />
    </TooltipProvider>
  )
  await screen.findByText('No plans available')
  return result
}

it('places the labeled redemption form before topup amounts and redeems with Enter', async () => {
  const onRedeem = vi.fn()
  render(
    <RechargeTab
      {...rechargeProps}
      redemptionCode='valid-code'
      onRedeem={onRedeem}
    />
  )
  const input = screen.getByRole('textbox', { name: 'Redemption Code' })
  const amount = screen.getByRole('spinbutton', { name: 'Custom Amount (USD)' })
  expect(
    input.compareDocumentPosition(amount) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  input.focus()
  await userEvent.keyboard('{Enter}')
  expect(onRedeem).toHaveBeenCalledOnce()
})

it.each([
  { code: '   ', redeeming: false },
  { code: 'valid-code', redeeming: true },
])(
  'prevents redemption of blank codes and duplicate submissions: %j',
  async ({ code, redeeming }) => {
    const onRedeem = vi.fn()
    render(
      <RechargeTab
        {...rechargeProps}
        redemptionCode={code}
        redeeming={redeeming}
        onRedeem={onRedeem}
      />
    )
    expect(screen.getByRole('button', { name: 'Redeem' })).toBeDisabled()
    screen.getByRole('textbox', { name: 'Redemption Code' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(onRedeem).not.toHaveBeenCalled()
  }
)

it('exposes the selected recharge preset to assistive technology', () => {
  render(<RechargeTab {...rechargeProps} />)
  expect(screen.getByRole('button', { name: /\$100/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

it('keeps redemption available when online topup is disabled', () => {
  render(<RechargeTab {...rechargeProps} hupijiaoEnabled={false} />)
  expect(screen.getByRole('textbox', { name: 'Redemption Code' })).toBeVisible()
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument()
})

it('places a compact active subscription before the full-width plan catalog', async () => {
  const { container } = await renderSubscriptions([subscription(1)])
  const overview = screen.getByRole('region', { name: 'My Subscriptions' })
  const catalog = screen.getByText('Subscription Plans')
  expect(
    overview.compareDocumentPosition(catalog) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(within(overview).getByText('Plan 1')).toBeVisible()
  expect(
    container.querySelector('[data-slot="subscription-layout"]')
  ).toHaveClass('flex-col')
  expect(
    screen.queryByRole('button', { name: /Manage subscriptions/ })
  ).not.toBeInTheDocument()
})

it('keeps multiple subscriptions compact until keyboard expansion enables ordering', async () => {
  await renderSubscriptions([subscription(1), subscription(2), subscription(3)])
  expect(screen.getByText('Plan 1')).toBeVisible()
  expect(screen.queryByText('Plan 2')).not.toBeInTheDocument()
  const manage = screen.getByRole('button', { name: /Manage subscriptions/ })
  expect(manage).toHaveAttribute('aria-expanded', 'false')
  manage.focus()
  await userEvent.keyboard('{Enter}')
  expect(manage).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('Plan 2')).toBeVisible()
  expect(
    screen.getAllByRole('button', { name: 'Drag to reorder' })
  ).toHaveLength(3)
  await userEvent.click(screen.getByRole('button', { name: /Collapse/ }))
  expect(screen.queryByText('Plan 2')).not.toBeInTheDocument()
})

it('keeps the empty subscription overview short and the catalog visible', async () => {
  await renderSubscriptions([])
  expect(screen.getByText('No subscription records')).toBeVisible()
  expect(screen.getByText('No plans available')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /Manage subscriptions/ })
  ).not.toBeInTheDocument()
})

it('returns to the compact overview when a refresh leaves only one subscription', async () => {
  const records = [subscription(1), subscription(2)]
  await renderSubscriptions(records)
  await userEvent.click(
    screen.getByRole('button', { name: /Manage subscriptions/ })
  )
  expect(screen.getByText('Plan 2')).toBeVisible()
  records.splice(1)
  const overview = screen.getByRole('region', { name: 'My Subscriptions' })
  await userEvent.click(
    within(overview).getByRole('button', { name: 'Refresh' })
  )
  expect(await within(overview).findByText('1 active')).toBeVisible()
  expect(within(overview).getByText('Plan 1')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Drag to reorder' })
  ).not.toBeInTheDocument()
})
