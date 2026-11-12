// Keep quota and purchase price separate. The existing payment amount field
// is retained for legacy products; only explicit pricing edits recalculate it.
export function calculatePlanQuotaUSD(
  price: number,
  multiplier: number
): number {
  if (
    !Number.isFinite(price) ||
    !Number.isFinite(multiplier) ||
    price <= 0 ||
    multiplier <= 0
  ) {
    return 0
  }
  return Math.floor((price / multiplier) * 1e6) / 1e6
}
