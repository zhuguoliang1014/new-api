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
import { expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { createFormValuesToPayload, PLAN_CREATE_FORM_DEFAULTS } from '../../lib'
import { subscriptionPlanSchema } from '../../types'
import { SubscriptionCreateDrawer } from '../subscription-create-drawer'
import { SubscriptionsProvider } from '../subscriptions-provider'

// Exercise the real editor and API payload; only the HTTP boundary is stubbed.
test.each([
  { action: 'switch', expected: '14' },
  { action: 'clear', expected: '' },
])(
  'persists a model provider $action from the editor',
  async ({ action, expected }) => {
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
          plan: expect.objectContaining({ allowed_channel_types: expected }),
        })
      )
    )
    client.clear()
  }
)
