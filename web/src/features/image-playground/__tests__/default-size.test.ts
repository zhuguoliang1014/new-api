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
// Presets follow CookSleep/gpt_image_playground and GPT Image 2 limits:
// edges divisible by 16, longest edge <= 3840, area <= 8,294,400 pixels.
import { expect, it } from 'vitest'

import { getStudioDefaultSize, getStudioSize } from '../lib/sizes'

it('selects the highest supported default on browsers without Array.findLast', () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    'findLast'
  )
  Object.defineProperty(Array.prototype, 'findLast', {
    value: undefined,
    configurable: true,
  })
  try {
    expect(
      getStudioDefaultSize({ max_resolution: 8, size_mode: 'upscale' }, '16:9')
    ).toBe(getStudioSize('16:9', '8K', 'upscale'))
    expect(
      getStudioDefaultSize({ max_resolution: 0, size_mode: 'native' })
    ).toBe(getStudioSize('1:1', '1K', 'native'))
  } finally {
    if (descriptor) {
      Object.defineProperty(Array.prototype, 'findLast', descriptor)
    } else Reflect.deleteProperty(Array.prototype, 'findLast')
  }
})
