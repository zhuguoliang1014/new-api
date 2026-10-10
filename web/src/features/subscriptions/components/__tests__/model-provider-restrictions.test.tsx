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
import { t } from 'i18next'
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import {
  createFormValuesToPayload,
  PLAN_CREATE_FORM_DEFAULTS,
  getPlanCreateFormSchema,
  getPlanFormSchema,
  planToCreateFormValues,
  planToFormValues,
  formValuesToPlanPayload,
} from '../../lib'
import { subscriptionPlanSchema } from '../../types'
import { SubscriptionCreateDrawer } from '../subscription-create-drawer'
import { SubscriptionsProvider } from '../subscriptions-provider'

// Exercise the real editor and API payload; only the HTTP boundary is stubbed.
test.each([
  { action: 'switch', expected: '14', ratio: 0.75 },
  { action: 'clear', expected: '', ratio: null },
])(
  'persists a model provider $action from the editor',
  async ({ action, expected, ratio }) => {
    const user = userEvent.setup()
    vi.spyOn(api, 'get').mockResolvedValue({
      data: { success: true, data: [] },
    })
    const save = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ data: { success: true } })
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const plan = subscriptionPlanSchema.parse({
      ...createFormValuesToPayload(
        {
          ...PLAN_CREATE_FORM_DEFAULTS,
          title: 'GPT plan',
          price_amount: 10,
          price_cny: 70,
          allowed_channel_types: [1],
          billing_ratio: 0.5,
        },
        500000
      ).plan,
      id: 7,
    })
    render(
      <QueryClientProvider client={client}>
        <SubscriptionsProvider>
          <SubscriptionCreateDrawer
            open
            onOpenChange={() => {}}
            currentRow={{ plan }}
          />
        </SubscriptionsProvider>
      </QueryClientProvider>
    )
    const multiplier = await screen.findByRole('spinbutton', {
      name: 'Plan billing multiplier',
    })
    expect(multiplier).toHaveValue(0.5)
    await user.clear(multiplier)
    await user.type(multiplier, '0')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(
      await screen.findByText('Billing multiplier must be greater than zero')
    ).toBeVisible()
    expect(save).not.toHaveBeenCalled()
    await user.clear(multiplier)
    if (ratio !== null) await user.type(multiplier, String(ratio))
    const selector = await screen.findByRole('combobox', {
      name: 'Allow all model providers',
    })
    await user.click(selector)
    await user.click(
      await screen.findByRole('option', { name: 'OpenAI (GPT / o-series)' })
    )
    if (action === 'switch') {
      await user.click(
        await screen.findByRole('option', { name: 'Anthropic (Claude)' })
      )
    }
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        '/api/subscription/admin/plans/7',
        expect.objectContaining({
          plan: expect.objectContaining({
            allowed_channel_types: expected,
            billing_ratio: ratio,
          }),
        })
      )
    )
    client.clear()
  }
)

test.each([undefined, null])(
  'older plans without a multiplier default to one (%s)',
  (billing_ratio) => {
    const plan = subscriptionPlanSchema.parse({
      ...createFormValuesToPayload(
        { ...PLAN_CREATE_FORM_DEFAULTS, title: 'Legacy plan', price_cny: 70 },
        500000
      ).plan,
      id: 7,
      billing_ratio,
    })
    expect(planToCreateFormValues(plan).billing_ratio).toBe(1)
    expect(planToFormValues(plan).billing_ratio).toBe(1)
    expect(
      formValuesToPlanPayload(planToFormValues(plan)).plan.billing_ratio
    ).toBe(1)
  }
)

test.each([0, -1, Infinity, Number.NaN])(
  'both editors reject invalid billing multiplier %s',
  (billing_ratio) => {
    const values = {
      ...PLAN_CREATE_FORM_DEFAULTS,
      title: 'Restricted plan',
      price_cny: 70,
      billing_ratio,
    }
    expect(getPlanCreateFormSchema(t).safeParse(values).success).toBe(false)
    expect(
      getPlanFormSchema(t).shape.billing_ratio.safeParse(billing_ratio).success
    ).toBe(false)
  }
)
