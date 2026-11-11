import { getPromotionQuote } from '@/features/subscriptions/lib/promotion'
import type { PlanRecord } from '@/features/subscriptions/types'

export interface RechargePricing {
  /** Payment currency charged per 1 USD of wallet quota. */
  unitPrice: number
}

export interface PlanSavings {
  /** Effective group ratio when paying through this plan. */
  planRatio: number
  /** Group ratio of the comparison group when paying from recharged balance. */
  rechargeRatio: number
  /** Fraction saved versus recharging, between 0 and 1. */
  savings: number
}

export interface UserGroup {
  desc: string
  ratio: number | string
}

export function getSavingsPercent(savings: number): number {
  if (!Number.isFinite(savings) || savings <= 0 || savings >= 1) return 0
  // Round the approximate display without changing the underlying ratios.
  // A paid plan must not round up to a claim of 100% savings.
  return Math.min(99, Math.round(savings * 100))
}

export function computePlanSavings(
  record: PlanRecord,
  comparisonRatio: number,
  pricing: RechargePricing,
  now = Math.floor(Date.now() / 1000)
): PlanSavings | null {
  const plan = getPromotionQuote(record, now).plan
  if (!plan) {
    return null
  }
  const priceCny = Number(plan.price_cny || 0)
  const quotaUsd = Number(record.total_amount_usd || 0)
  const billingRatio = plan.billing_ratio ?? 1
  if (
    ![
      priceCny,
      quotaUsd,
      billingRatio,
      comparisonRatio,
      pricing.unitPrice,
    ].every((value) => Number.isFinite(value) && value > 0)
  ) {
    return null
  }

  const planRatio = (priceCny / quotaUsd / pricing.unitPrice) * billingRatio
  const rechargeRatio = comparisonRatio
  const savings = 1 - planRatio / rechargeRatio
  if (
    !Number.isFinite(planRatio) ||
    planRatio <= 0 ||
    savings <= 0 ||
    savings >= 1
  ) {
    return null
  }
  return { planRatio, rechargeRatio, savings }
}

export function computeSavingsByPlan(
  plans: PlanRecord[],
  comparisonRatio: number,
  pricing: RechargePricing,
  now = Math.floor(Date.now() / 1000)
): Map<number, PlanSavings> {
  const result = new Map<number, PlanSavings>()
  for (const record of plans) {
    if (!record.plan?.enabled) continue
    const savings = computePlanSavings(record, comparisonRatio, pricing, now)
    if (savings) result.set(record.plan.id, savings)
  }
  return result
}

export function filterGPTGroups(
  groups: Record<string, UserGroup> | undefined
): Array<{ name: string; ratio: number }> {
  if (!groups) return []
  return Object.entries(groups)
    .filter(([name]) => name.toUpperCase().includes('GPT'))
    .map(([name, info]) => ({
      name,
      ratio: typeof info.ratio === 'string' ? Number(info.ratio) : info.ratio,
    }))
    .filter((g) => Number.isFinite(g.ratio) && g.ratio > 0)
    .sort((a, b) => b.ratio - a.ratio)
}
