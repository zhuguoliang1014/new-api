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
const pendingImages = new Map<string, Promise<void>>()

/** Share only in-flight loads so navigation does not accumulate cached images. */
export function preloadImage(source: string): Promise<void> {
  const pending = pendingImages.get(source)
  if (pending) return pending
  const image = new Image()
  const result = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('Image could not be loaded'))
  }).finally(() => {
    pendingImages.delete(source)
    image.onload = null
    image.onerror = null
  })
  pendingImages.set(source, result)
  image.src = source
  return result
}
