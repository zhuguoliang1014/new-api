import type { PlanRecord } from '../types'

export function getPromotionRate(record: PlanRecord, now: number): number {
  const plan = record.plan
  const rate = Number(plan.discount_rate ?? 1)
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 1) return 1
  if (
    now < (plan.discount_starts_at || 0) ||
    now >= (plan.discount_ends_at || 0)
  ) {
    return 1
  }
  return rate
}

export function getPromotionQuote(record: PlanRecord, now: number): PlanRecord {
  if (record.regular_price_cny == null || record.regular_price_amount == null) {
    return record
  }
  const rate = getPromotionRate(record, now)
  return {
    ...record,
    plan: {
      ...record.plan,
      price_cny:
        rate < 1
          ? (record.discount_price_cny ??
            Math.round(
              (record.regular_price_cny * rate + Number.EPSILON) * 100
            ) / 100)
          : record.regular_price_cny,
      price_amount:
        rate < 1
          ? (record.discount_price_amount ??
            Math.round(
              (record.regular_price_amount * rate + Number.EPSILON) * 1e6
            ) / 1e6)
          : record.regular_price_amount,
    },
  }
}
