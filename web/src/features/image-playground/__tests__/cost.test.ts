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
import { describe, expect, it } from 'vitest'

import type { PricingModel } from '@/features/pricing/types'

import { estimateStudioCost } from '../lib/cost'
import { defaultImageParameters } from '../types'

const model: PricingModel = {
  id: 0,
  model_name: 'gpt-image-2',
  quota_type: 0,
  model_ratio: 37.5,
  completion_ratio: 2,
  model_price: 9,
  enable_groups: ['basic', 'high', 'native'],
  billing_mode: 'tiered_expr',
  billing_expr: 'tier("image", fixed(0.1)) * image_count',
}

describe('studio recharge cost estimate', () => {
  it.each([
    [0.3, 1, 0.03],
    [1.2, 4, 0.48],
    [2.25, 1, 0.225],
    [0, 4, 0],
  ])(
    'uses group %s and count %s to estimate %s yuan from the expression',
    (ratio, count, cost) => {
      expect(
        estimateStudioCost(
          model,
          { ...defaultImageParameters, count },
          ratio,
          1
        )
      ).toBeCloseTo(cost)
    }
  )
  it('uses the configured recharge conversion instead of a market USD exchange rate', () => {
    expect(
      estimateStudioCost(model, defaultImageParameters, 1.2, 2)
    ).toBeCloseTo(0.24)
  })
  it('evaluates request quality and quantity once without multiplying image_count twice', () => {
    const priced = {
      ...model,
      billing_expr:
        'tier("image", fixed(0.1)) * image_count * (param("quality") == "high" ? 2 : 1)',
    }
    expect(
      estimateStudioCost(
        priced,
        { ...defaultImageParameters, quality: 'high', count: 3 },
        1.2,
        1
      )
    ).toBeCloseTo(0.72)
  })
  it('does not invent a token or header price or use the obsolete legacy fallback', () => {
    for (const expression of [
      'tier("token", p * 2 + c * 8)',
      'tier("request", fixed(0.1)) * (header("x-price") == "high" ? 3 : 1)',
      'broken(',
    ]) {
      expect(
        estimateStudioCost(
          { ...model, billing_expr: expression },
          defaultImageParameters,
          1.2,
          1
        )
      ).toBeNull()
    }
  })
  it('keeps an explicitly free model free', () => {
    expect(
      estimateStudioCost(
        { ...model, billing_expr: 'tier("image", fixed(0)) * image_count' },
        defaultImageParameters,
        1.2,
        1
      )
    ).toBe(0)
  })
  it('uses a per-image legacy price only when expression pricing is inactive', () => {
    expect(
      estimateStudioCost(
        { ...model, billing_mode: 'ratio', quota_type: 1, model_price: 0.2 },
        { ...defaultImageParameters, count: 2 },
        0.3,
        1
      )
    ).toBeCloseTo(0.12)
  })
  it('withholds the estimate if its configuration is unknown or the count is invalid', () => {
    expect(
      estimateStudioCost(undefined, defaultImageParameters, 1.2, 1)
    ).toBeNull()
    expect(
      estimateStudioCost(model, defaultImageParameters, undefined, 1)
    ).toBeNull()
    expect(
      estimateStudioCost(model, defaultImageParameters, 1.2, undefined)
    ).toBeNull()
    expect(
      estimateStudioCost(
        model,
        { ...defaultImageParameters, count: 128 },
        1.2,
        1
      )
    ).toBeNull()
    expect(
      estimateStudioCost(model, defaultImageParameters, Infinity, 1)
    ).toBeNull()
  })
})
