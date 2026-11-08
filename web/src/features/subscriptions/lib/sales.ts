import type { PlanRecord } from '../types'

export function getPlanSalesState(record: PlanRecord | null | undefined) {
  const limit = Math.max(0, Number(record?.plan.sales_limit || 0))
  const remaining = Math.max(
    0,
    record?.remaining_count ??
      limit - (record?.paid_count || 0) - (record?.reserved_count || 0)
  )
  const limited = limit > 0
  const soldOut =
    limited && (record?.sold_out === true || (record?.paid_count || 0) >= limit)
  return {
    limit,
    remaining,
    limited,
    soldOut,
    unavailable:
      limited &&
      (soldOut || record?.sales_unavailable === true || remaining === 0),
  }
}
