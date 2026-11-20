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
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getBrandingImage } from '../branding-images'

const original =
  'https://92ai.asia/static/uploads/images/20261029-aiproxy-brand-light-52157c6838a3.png'

describe('branding image sizes', () => {
  it('serves the production logo as a content-versioned asset outside startup JavaScript', () => {
    const logo = getBrandingImage(original)
    expect(logo).toMatch(
      /^\/assets\/branding\/aiproxy-logo-[a-f0-9]{12}\.webp$/
    )
    const bytes = readFileSync(resolve('public', logo.slice(1)))
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12)
    expect(logo).toBe(`/assets/branding/aiproxy-logo-${hash}.webp`)
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP')
  })

  it('uses small bundled variants for the known production source without changing the brand', () => {
    expect(getBrandingImage(original)).not.toBe(original)
    expect(getBrandingImage(original, 'favicon')).not.toBe(original)
    expect(getBrandingImage(original, 'favicon')).not.toBe(
      getBrandingImage(original)
    )
    expect(getBrandingImage(new URL(original).pathname)).toBe(
      getBrandingImage(original)
    )
    expect(getBrandingImage(`${original}?v=2`)).toBe(getBrandingImage(original))
  })

  it.each([
    '/logo.png',
    'https://example.com/custom.svg',
    original.replace('92ai.asia', 'example.com'),
    original.replace('52157c6838a3', 'new-brand'),
    'data:image/png;base64,abc',
  ])('preserves another configured logo %s', (source) => {
    expect(getBrandingImage(source)).toBe(source)
    expect(getBrandingImage(source, 'favicon')).toBe(source)
  })
})
