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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import { api } from '@/lib/api'

import { ModelDetailsContent } from '../components/model-details'

// The chart package needs the browser renderer; the tab's empty-data behavior
// is independent of canvas drawing and is also checked in the browser QA.
vi.mock('@visactor/react-vchart', () => ({ VChart: () => null }))

it('loads API and performance content when their tabs are activated and returns to the overview', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { groups: [], series: [], summary: {} } },
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <ModelDetailsContent
          model={{
            id: 1,
            model_name: 'example-model',
            quota_type: 0,
            model_ratio: 1,
            completion_ratio: 1,
            enable_groups: ['default'],
            supported_endpoint_types: ['openai'],
          }}
          groupRatio={{ default: 1 }}
          usableGroup={{ default: { desc: '', ratio: 1 } }}
          endpointMap={{
            openai: { path: '/v1/chat/completions', method: 'POST' },
          }}
          autoGroups={[]}
          priceRate={1}
          usdExchangeRate={1}
          tokenUnit='M'
        />
      </ThemeProvider>
    </QueryClientProvider>
  )
  try {
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: 'API' }))
    expect(
      await screen.findByRole('heading', { name: 'Code samples' })
    ).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Supported parameters' })
    ).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Performance' }))
    expect(
      await screen.findByText(
        'Performance data is not yet available for this model.'
      )
    ).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByRole('heading', { name: 'Pricing' })).toBeVisible()
  } finally {
    view.unmount()
    client.clear()
  }
})
