import type { PlanRecord } from '../types'

export function getPlanSalesState(record: PlanRecord | null | undefined) {
  const limit = Math.max(0, Number(record?.plan.sales_limit || 0))
  const sold =
    (record?.paid_count || 0) +
    Math.max(0, record?.plan.display_sold_count || 0)
  const remaining = Math.max(
    0,
    record?.remaining_count ?? limit - sold - (record?.reserved_count || 0)
  )
  const limited = limit > 0
  const soldOut = limited && (record?.sold_out === true || sold >= limit)
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
