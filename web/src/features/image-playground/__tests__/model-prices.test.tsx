import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

import { getPricing } from '@/features/pricing/api'
import { useAuthStore } from '@/stores/auth-store'

import { StudioCostEstimate } from '../components/studio-cost-estimate'
import { useImagePlaygroundStore } from '../store'
import { defaultImageParameters } from '../types'

vi.mock('@/features/pricing/api', () => ({ getPricing: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  getStatus: vi.fn().mockResolvedValue({ price: 1 }),
}))

const group = {
  id: 'studio',
  name: 'Studio',
  description: '',
  ratio: 1,
  available: true,
  models: ['mj-v8.2', 'gemini-3-pro-image-preview'],
  max_resolution: 4,
  size_mode: 'upscale' as const,
}

beforeEach(() => {
  useAuthStore.setState((state) => ({
    auth: {
      ...state.auth,
      session: {
        sid: 'prices-session',
        current: true,
        login_method: 'password',
        ip: '',
        user_agent: '',
        created_at: 0,
        last_active_at: 0,
        expires_at: 9999999999,
      },
    },
  }))
  useImagePlaygroundStore.setState({
    parameters: { ...defaultImageParameters, group: 'studio', count: 4 },
  })
  vi.mocked(getPricing).mockResolvedValue({
    success: true,
    data: [
      {
        id: 0,
        model_name: 'mj-v8.2',
        quota_type: 0,
        model_ratio: 1,
        completion_ratio: 1,
        enable_groups: ['studio'],
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("request", fixed(1.3))',
      },
    ],
    vendors: [],
    group_ratio: {},
    usable_group: {},
    supported_endpoint: {},
    auto_groups: [],
  })
})

function showPrice(model = 'mj-v8.2') {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StudioCostEstimate group={group} model={model} presentation='unit' />
    </QueryClientProvider>
  )
}

it('labels MJ per request and calculates that model instead of the selected draft model', async () => {
  showPrice()
  expect(await screen.findByText('¥1.3/request')).toBeInTheDocument()
})

it('does not display a made-up zero when a model has no usable price', async () => {
  showPrice('gemini-3-pro-image-preview')
  expect(await screen.findByText('—')).toHaveAttribute(
    'title',
    'Cost estimate unavailable'
  )
  expect(screen.queryByText('¥0/image')).not.toBeInTheDocument()
})

it('preserves a configured free price and labels image billing per image', async () => {
  const response = await getPricing()
  response.data[0] = {
    ...response.data[0],
    model_name: 'gemini-3-pro-image-preview',
    billing_expr: 'tier("image", fixed(0)) * image_count',
  }
  vi.mocked(getPricing).mockResolvedValue(response)
  showPrice('gemini-3-pro-image-preview')
  expect(await screen.findByText('¥0/image')).toBeInTheDocument()
})
