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
import { compileBillingExpression } from '@/features/pricing/lib/billing-expression/parser'
import { evaluateBillingExpression } from '@/features/pricing/lib/billing-expression/runtime'
import type { PricingModel } from '@/features/pricing/types'

import {
  getImageRequestFields,
  normalizeImageParameters,
  type ImageParameters,
} from '../types'

/** Display-only CNY estimate at the site's base recharge rate; never used to settle. */
export function estimateStudioCost(
  model: PricingModel | undefined,
  parameters: ImageParameters,
  groupRatio: number | undefined,
  rechargeRate: number | undefined,
  now?: Date
): number | null {
  if (
    !model ||
    model.model_name !== parameters.model ||
    groupRatio === undefined ||
    !Number.isFinite(groupRatio) ||
    groupRatio < 0 ||
    rechargeRate === undefined ||
    !Number.isFinite(rechargeRate) ||
    rechargeRate <= 0 ||
    !Number.isInteger(parameters.count) ||
    parameters.count < 1 ||
    parameters.count > 4
  ) {
    return null
  }

  const normalized = normalizeImageParameters(parameters)
  let dollars: number
  if (model.billing_mode === 'tiered_expr') {
    const compiled = compileBillingExpression(model.billing_expr ?? '')
    if (
      compiled.status !== 'ready' ||
      compiled.functions.has('header') ||
      compiled.functions.has('u')
    ) {
      return null
    }
    // Tokens and upstream usage are unknown before generation. Do not turn
    // their absence into zero or fall back to a stale legacy model_price.
    if ([...compiled.variables].some((name) => name !== 'image_count')) {
      return null
    }
    const result = evaluateBillingExpression(compiled, {
      imageCount: normalized.count,
      request: { body: getImageRequestFields(normalized) },
      now,
    })
    if (result.status !== 'success' || result.billingUnit !== 'request') {
      return null
    }
    dollars = result.cost / 1_000_000
  } else if (model.quota_type === 1 && typeof model.model_price === 'number') {
    dollars = model.model_price * normalized.count
  } else {
    return null
  }
  const cost = dollars * groupRatio * rechargeRate
  return Number.isFinite(cost) && cost >= 0 ? cost : null
}
