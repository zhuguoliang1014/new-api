import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { useSubscriptionSavings } from '../use-subscription-savings'

const pricing = { unitPrice: 1 }

function gptPlan(id: number, priceCny: number, quotaUsd: number) {
  return {
    total_amount_usd: quotaUsd,
    plan: {
      id,
      title: `Plan ${id}`,
      price_cny: priceCny,
      enabled: true,
      allowed_channel_types: '1',
      billing_ratio: 1,
    },
  }
}

function wrapper(props: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>{props.children}</QueryClientProvider>
  )
}

function mockApi(
  groups: Record<string, { desc: string; ratio: number }>,
  plans: ReturnType<typeof gptPlan>[] = [gptPlan(1, 300, 1155)]
) {
  vi.spyOn(api, 'get').mockImplementation((url) => {
    if (url === '/api/subscription/plans') {
      return Promise.resolve({ data: { success: true, data: plans } })
    }
    if (url === '/api/user/self/groups') {
      return Promise.resolve({ data: { success: true, data: groups } })
    }
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

afterEach(() => vi.restoreAllMocks())

it('compares against the highest-ratio GPT group without any user selection', async () => {
  mockApi({
    '【新】GPT稳定号池': { desc: 'GPT stable', ratio: 0.36 },
    '【新】GPT普通号池': { desc: 'GPT normal', ratio: 0.25 },
    'claude-max': { desc: 'Claude', ratio: 0.8 },
  })

  const { result } = renderHook(() => useSubscriptionSavings(pricing), {
    wrapper,
  })

  await waitFor(() => expect(result.current.byPlan.size).toBe(1))
  // 0.36 wins over 0.25; the 0.8 Claude group is excluded by name.
  expect(result.current.byPlan.get(1)?.rechargeRatio).toBe(0.36)
  expect(result.current.comparisonGroup).toBe('【新】GPT稳定号池')
})

it('ignores non-GPT groups even when they have the highest ratio', async () => {
  mockApi(
    {
      '【新】GPT普通号池': { desc: 'GPT normal', ratio: 0.25 },
      '【新】aws-claude-高缓存': { desc: 'Claude', ratio: 1 },
    },
    [gptPlan(1, 200, 1155)]
  )

  const { result } = renderHook(() => useSubscriptionSavings(pricing), {
    wrapper,
  })

  await waitFor(() => expect(result.current.byPlan.size).toBe(1))
  expect(result.current.byPlan.get(1)?.rechargeRatio).toBe(0.25)
})

it('reports max savings across plans for the tab badge', async () => {
  vi.spyOn(api, 'get').mockImplementation((url) => {
    if (url === '/api/subscription/plans') {
      return Promise.resolve({
        data: {
          success: true,
          data: [gptPlan(1, 300, 1155), gptPlan(2, 2000, 8800)],
        },
      })
    }
    if (url === '/api/user/self/groups') {
      return Promise.resolve({
        data: {
          success: true,
          data: {
            '【新】GPT稳定号池': { desc: 'GPT stable', ratio: 0.36 },
          },
        },
      })
    }
    return Promise.reject(new Error(`unexpected ${url}`))
  })

  const { result } = renderHook(() => useSubscriptionSavings(pricing), {
    wrapper,
  })

  await waitFor(() => expect(result.current.byPlan.size).toBe(2))
  expect(result.current.maxSavings).toBeCloseTo(1 - 2000 / 8800 / 0.36)
})

it('reports no savings when the user has no GPT group', async () => {
  mockApi({ 'claude-max': { desc: 'Claude', ratio: 0.8 } })

  const { result } = renderHook(() => useSubscriptionSavings(pricing), {
    wrapper,
  })

  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  expect(result.current.byPlan.size).toBe(0)
  expect(result.current.maxSavings).toBe(0)
})
