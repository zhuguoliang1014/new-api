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
import { expect, it } from 'vitest'

import { defaultPosterSettings } from '../lib/creative'
import { exportPoster, wrapPosterText } from '../lib/poster-export'

it('wraps Chinese text and explicit newlines without splitting Unicode characters', () => {
  expect(
    wrapPosterText('自然🌿形状\n光影', (v) => [...v].length * 10, 30)
  ).toEqual(['自然🌿', '形状', '光影'])
})
it('rejects animated and vector originals instead of flattening them silently', async () => {
  for (const type of ['image/gif', 'image/svg+xml']) {
    await expect(
      exportPoster(new Blob(['image'], { type }), defaultPosterSettings)
    ).rejects.toThrow('Choose a static')
  }
})
