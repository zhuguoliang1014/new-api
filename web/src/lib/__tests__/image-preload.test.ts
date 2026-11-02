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
import { afterEach, expect, it, vi } from 'vitest'

import { preloadImage } from '../image-preload'

afterEach(() => vi.unstubAllGlobals())

it('shares one in-flight image between simultaneous consumers and permits a later load', async () => {
  const images: {
    src: string
    onload: (() => void) | null
    onerror: (() => void) | null
  }[] = []
  vi.stubGlobal(
    'Image',
    class {
      src = ''
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor() {
        images.push(this)
      }
    }
  )
  const first = preloadImage('/shared-logo.png')
  const second = preloadImage('/shared-logo.png')
  expect(images).toHaveLength(1)
  images[0].onload?.()
  await Promise.all([first, second])
  const next = preloadImage('/shared-logo.png')
  expect(images).toHaveLength(2)
  images[1].onload?.()
  await next
})

it('clears failed image loads so the source can be retried', async () => {
  const images: {
    onload: (() => void) | null
    onerror: (() => void) | null
  }[] = []
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      src = ''
      constructor() {
        images.push(this)
      }
    }
  )
  const first = preloadImage('/failed-logo.png')
  const rejected = expect(first).rejects.toThrow()
  images[0].onerror?.()
  await rejected
  const retry = preloadImage('/failed-logo.png')
  expect(images).toHaveLength(2)
  images[1].onload?.()
  await retry
})
