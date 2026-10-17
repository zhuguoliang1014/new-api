import { describe, expect, it } from 'vitest'

import type {
  PlanRecord,
  SubscriptionPlan,
} from '@/features/subscriptions/types'

import {
  computePlanSavings,
  computeSavingsByPlan,
  filterGPTGroups,
} from '../subscription-savings'

const pricing = { unitPrice: 1 }

function record(
  overrides: Partial<SubscriptionPlan> = {},
  totalAmountUsd = 1155
): PlanRecord {
  return {
    total_amount_usd: totalAmountUsd,
    plan: {
      id: 24,
      title: '启航版',
      price_amount: 1155,
      price_cny: 300,
      currency: 'USD',
      duration_unit: 'month',
      duration_value: 1,
      quota_reset_period: 'never',
      enabled: true,
      allow_balance_pay: true,
      allow_wallet_overflow: true,
      sort_order: 0,
      max_purchase_per_user: 0,
      total_amount: 577500000,
      allowed_channel_types: '1',
      billing_ratio: 1,
      ...overrides,
    },
  }
}

describe('computePlanSavings', () => {
  it('compares a plan with a comparison group ratio', () => {
    const result = computePlanSavings(record({}, 1155), 0.36, pricing)

    expect(result?.planRatio).toBeCloseTo(300 / 1155)
    expect(result?.rechargeRatio).toBe(0.36)
    expect(result?.savings).toBeCloseTo(1 - 300 / 1155 / 0.36)
  })

  it('converts the plan price into quota using the recharge unit price', () => {
    const result = computePlanSavings(record({}, 1155), 0.36, { unitPrice: 2 })

    expect(result?.planRatio).toBeCloseTo(300 / 1155 / 2)
  })

  it('scales the plan ratio by the plan billing ratio', () => {
    const result = computePlanSavings(
      record({ billing_ratio: 0.5 }, 1155),
      0.36,
      pricing
    )

    expect(result?.planRatio).toBeCloseTo((300 / 1155) * 0.5)
  })

  it('returns null when comparison ratio is zero or negative', () => {
    expect(computePlanSavings(record(), 0, pricing)).toBeNull()
    expect(computePlanSavings(record(), -1, pricing)).toBeNull()
  })

  it('returns null when the plan is not cheaper than recharging', () => {
    expect(
      computePlanSavings(record({ price_cny: 1000 }, 1155), 0.36, pricing)
    ).toBeNull()
  })

  it('returns null when price, quota or ratios are missing', () => {
    expect(
      computePlanSavings(record({ price_cny: 0 }, 1155), 0.36, pricing)
    ).toBeNull()
    expect(computePlanSavings(record({}, 0), 0.36, pricing)).toBeNull()
    expect(
      computePlanSavings(record({}, 1155), 0.36, { unitPrice: 0 })
    ).toBeNull()
  })
})

describe('computeSavingsByPlan', () => {
  it('skips disabled plans and keys results by plan id', () => {
    const result = computeSavingsByPlan(
      [record({}, 1155), record({ id: 2, enabled: false }, 1155)],
      0.36,
      pricing
    )

    expect([...result.keys()]).toEqual([24])
  })
})

describe('filterGPTGroups', () => {
  it('filters groups containing GPT (case insensitive) and sorts by ratio descending', () => {
    const groups = {
      '【新】GPT稳定号池': { desc: 'GPT stable', ratio: 0.36 },
      '【新】GPT普通号池': { desc: 'GPT normal', ratio: 0.25 },
      'claude-max': { desc: 'Claude', ratio: 0.8 },
      国模分组: { desc: 'Local', ratio: 0.12 },
    }

    const result = filterGPTGroups(groups)

    expect(result).toEqual([
      { name: '【新】GPT稳定号池', ratio: 0.36 },
      { name: '【新】GPT普通号池', ratio: 0.25 },
    ])
  })

  it('parses string ratios', () => {
    const groups = {
      'GPT-4': { desc: 'GPT-4', ratio: '0.5' },
    }

    const result = filterGPTGroups(groups)

    expect(result).toEqual([{ name: 'GPT-4', ratio: 0.5 }])
  })

  it('returns empty array when groups is undefined', () => {
    expect(filterGPTGroups(undefined)).toEqual([])
  })

  it('filters out zero or negative ratios', () => {
    const groups = {
      'GPT-A': { desc: 'A', ratio: 0 },
      'GPT-B': { desc: 'B', ratio: -1 },
      'GPT-C': { desc: 'C', ratio: 0.5 },
    }

    const result = filterGPTGroups(groups)

    expect(result).toEqual([{ name: 'GPT-C', ratio: 0.5 }])
  })
})

it.each([
  ['NaN comparison', 300, 1155, Number.NaN, 1],
  ['infinite comparison', 300, 1155, Number.POSITIVE_INFINITY, 1],
  ['infinite plan price', Number.POSITIVE_INFINITY, 1155, 0.36, 1],
  ['infinite quota', 300, Number.POSITIVE_INFINITY, 0.36, 1],
  ['infinite recharge price', 300, 1155, 0.36, Number.POSITIVE_INFINITY],
])(
  'hides savings for invalid pricing: %s',
  (_name, price, quota, ratio, unitPrice) => {
    expect(
      computePlanSavings(record({ price_cny: price }, quota), ratio, {
        unitPrice,
      })
    ).toBeNull()
  }
)

it('excludes invalid GPT group ratios instead of advertising a 100% discount', () => {
  expect(
    filterGPTGroups({
      'GPT-invalid': { desc: 'invalid', ratio: Number.POSITIVE_INFINITY },
      'GPT-text': { desc: 'invalid text', ratio: '0.36invalid' },
      'GPT-valid': { desc: 'valid', ratio: 0.36 },
    })
  ).toEqual([{ name: 'GPT-valid', ratio: 0.36 }])
})
