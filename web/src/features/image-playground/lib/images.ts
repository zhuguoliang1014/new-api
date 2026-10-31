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
import { t } from 'i18next'

import type { ImageOutput, ImageRecord } from '../types'

export function validateReferenceFiles(files: File[]): void {
  if (files.length > 4) throw new Error(t('Use up to 4 reference images.'))
  for (const file of files) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      throw new Error(t('Upload PNG, JPEG or WebP images.'))
    }
    if (!file.size || file.size > 10 * 1024 * 1024) {
      throw new Error(t('Each reference image must be smaller than 10 MB.'))
    }
  }
}

export async function getImageBlob(
  src: string,
  signal?: AbortSignal
): Promise<Blob> {
  // Image hosts receive no API key or cookies. Remote hosts must allow CORS
  // for downloads/reference reuse; viewing the result does not require CORS.
  const response = await fetch(src, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
  if (!response.ok) {
    throw new Error(
      t('Could not download this image. Open the original image to save it.')
    )
  }
  const blob = await response.blob()
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
    throw new Error(t('Upload PNG, JPEG or WebP images.'))
  }
  return blob
}

function saveImageDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export async function downloadImage(src: string, id: string): Promise<void> {
  const blob = await getImageBlob(src)
  saveImageDownload(blob, `new-api-image-${id}.${blob.type.split('/')[1]}`)
}

export async function downloadImagesArchive(
  images: ImageOutput[],
  id: string,
  signal?: AbortSignal
): Promise<void> {
  if (!images.length || images.length > 4) {
    throw new Error(t('Use up to 4 images per download.'))
  }
  const [{ zipSync }, files] = await Promise.all([
    import('fflate'),
    Promise.all(
      images.map(async (image, index) => {
        const blob = await getImageBlob(image.src, signal)
        return {
          name: `new-api-image-${index + 1}.${blob.type.split('/')[1]}`,
          data: new Uint8Array(await blob.arrayBuffer()),
        }
      })
    ),
  ])
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  // Original PNG/JPEG/WebP bytes are already compressed; preserve them verbatim.
  const archive = zipSync(
    Object.fromEntries(files.map((file) => [file.name, file.data])),
    { level: 0 }
  )
  saveImageDownload(
    new Blob([new Uint8Array(archive)], { type: 'application/zip' }),
    `new-api-images-${id}.zip`
  )
}

/** Preserve original image bytes in the existing IndexedDB history format. */
export async function cacheImageRecord(
  record: ImageRecord,
  signal: AbortSignal
): Promise<ImageRecord> {
  const images = await Promise.all(
    record.images.map(async (image) => {
      if (!/^https?:\/\//i.test(image.src)) return image
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) controller.abort()
      // A stalled image host must not keep the studio busy indefinitely.
      const timeout = window.setTimeout(abort, 30000)
      try {
        const blob = await getImageBlob(image.src, controller.signal)
        if (controller.signal.aborted) return image
        const src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.addEventListener(
            'load',
            () => resolve(reader.result as string),
            { once: true }
          )
          reader.addEventListener('error', () => reject(reader.error), {
            once: true,
          })
          reader.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          )
          reader.readAsDataURL(blob)
        })
        return { ...image, src }
      } catch {
        // Keep usable links and the other images if this host rejects CORS,
        // the link expired, or the browser cannot read the original bytes.
        return image
      } finally {
        window.clearTimeout(timeout)
        signal.removeEventListener('abort', abort)
      }
    })
  )
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  return {
    ...record,
    images,
    localSaveStatus: images.some((image) => /^https?:/i.test(image.src))
      ? 'failed'
      : 'saved',
  }
}
