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

it('shares topup configuration and the same savings between sidebar and wallet consumers', async () => {
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown
    if (url === '/api/subscription/plans') data = [gptPlan(1, 300, 1155)]
    else if (url === '/api/user/self/groups') {
      data = { GPT: { desc: 'GPT', ratio: 0.36 } }
    } else if (url === '/api/user/topup/info') {
      data = {
        enable_online_topup: false,
        enable_hupijiao_topup: true,
        hupijiao_price: 1,
      }
    } else if (url === '/api/status') data = { price: 1 }
    else throw new Error(`unexpected ${url}`)
    return { data: { success: true, data } }
  })
  const { result } = renderHook(
    () => {
      const sidebar = useSubscriptionSavings()
      const wallet = useSubscriptionSavings()
      return { sidebar, wallet }
    },
    { wrapper }
  )
  await waitFor(() =>
    expect(result.current.sidebar.maxSavings).toBeGreaterThan(0)
  )
  expect(result.current.sidebar.maxSavings).toBe(
    result.current.wallet.maxSavings
  )
  expect(
    get.mock.calls.filter(([url]) => url === '/api/user/topup/info')
  ).toHaveLength(1)
  expect(
    get.mock.calls.filter(([url]) => url === '/api/subscription/plans')
  ).toHaveLength(1)
})
