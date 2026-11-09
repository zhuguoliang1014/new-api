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
import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

const css = readFileSync('src/styles/fashion-studio.css', 'utf8')
const route = readFileSync(
  'src/routes/_authenticated/image-playground/index.tsx',
  'utf8'
)
it('provides a vertical route scroll container inside the fixed-height shell', () => {
  expect(route).toContain('studio-page-scroll overflow-y-auto')
  expect(css).toMatch(/\.studio-page-scroll\s*\{[^}]*overflow-y:\s*auto/)
  expect(css).toMatch(
    /\.studio-page-scroll > \.fashion-studio\s*\{[^}]*flex:\s*0 0 auto/
  )
})
it('gives images a real height and compares two columns without container-query requirements', () => {
  expect(css).toMatch(
    /\.shoot-result-stage \.studio-image-button\s*\{[^}]*height: 490px/
  )
  expect(css).not.toContain('@container')
})
