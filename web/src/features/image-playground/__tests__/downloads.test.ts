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
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import {
  cacheImageRecord,
  downloadImage,
  downloadImagesArchive,
} from '../lib/images'
import { defaultImageParameters } from '../types'

const images = [
  { id: 'first', src: 'https://images.example/first.png' },
  { id: 'second', src: 'https://images.example/second.webp' },
]
let saved: Blob | null
let filename: string

beforeEach(() => {
  saved = null
  filename = ''
  vi.useFakeTimers()
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn((blob: Blob) => {
        saved = blob
        return 'blob:archive'
      }),
      revokeObjectURL: vi.fn(),
    })
  )
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement
  ) {
    filename = this.download
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          url.includes('first') ? 'original png bytes' : 'original webp bytes',
          {
            headers: {
              'Content-Type': url.includes('first')
                ? 'image/png'
                : 'image/webp',
            },
          }
        )
    )
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('downloads all original bytes into a ZIP with distinct filenames and releases its object URL', async () => {
  await downloadImagesArchive(images, 'creation')
  expect(filename).toBe('new-api-images-creation.zip')
  expect(saved?.type).toBe('application/zip')
  // jsdom supplies the browser Blob/FileReader boundary.
  const bytesPromise = new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener(
      'load',
      () => resolve(reader.result as ArrayBuffer),
      { once: true }
    )
    reader.addEventListener('error', () => reject(reader.error), { once: true })
    if (!saved) throw new Error('Expected the archive to be saved')
    reader.readAsArrayBuffer(saved)
  })
  await vi.runAllTimersAsync()
  const archive = unzipSync(new Uint8Array(await bytesPromise))
  expect(Object.keys(archive)).toEqual([
    'new-api-image-1.png',
    'new-api-image-2.webp',
  ])
  expect(new TextDecoder().decode(archive['new-api-image-1.png'])).toBe(
    'original png bytes'
  )
  expect(new TextDecoder().decode(archive['new-api-image-2.webp'])).toBe(
    'original webp bytes'
  )
  expect(fetch).toHaveBeenCalledWith(
    images[0].src,
    expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  )
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:archive')
  expect(document.querySelector('a[download]')).not.toBeInTheDocument()
})

it('reports a failed original download and never saves a partial archive', async () => {
  vi.mocked(fetch).mockImplementation(
    async (url) =>
      new Response('original', {
        status: String(url).includes('second') ? 403 : 200,
        headers: { 'Content-Type': 'image/png' },
      })
  )
  await expect(downloadImagesArchive(images, 'creation')).rejects.toThrow(
    'Could not download this image'
  )
  expect(URL.createObjectURL).not.toHaveBeenCalled()
  expect(filename).toBe('')
})

it('rejects non-image responses instead of putting them in a ZIP', async () => {
  vi.mocked(fetch).mockImplementation(
    async () =>
      new Response('<html>expired</html>', {
        headers: { 'Content-Type': 'text/html' },
      })
  )
  await expect(downloadImagesArchive(images, 'creation')).rejects.toThrow(
    'The response is not a supported image.'
  )
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('does not save an archive after the download is cancelled', async () => {
  const controller = new AbortController()
  const download = downloadImagesArchive(images, 'creation', controller.signal)
  controller.abort()
  await expect(download).rejects.toThrow('Aborted')
  expect(URL.createObjectURL).not.toHaveBeenCalled()
})

it('downloads GIF originals with a gif filename and preserves the animation bytes', async () => {
  const response = new Response()
  vi.spyOn(response, 'blob').mockResolvedValue(
    new Blob(['original animated GIF'], { type: 'image/gif' })
  )
  vi.mocked(fetch).mockResolvedValue(response)
  await downloadImage('https://images.example/cat.gif', 'cat')
  expect(filename).toBe('new-api-image-cat.gif')
  expect(saved?.type).toBe('image/gif')
  const bytes = new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)), {
      once: true,
    })
    if (!saved) throw new Error('Expected the GIF to be saved')
    reader.readAsText(saved)
  })
  await vi.runAllTimersAsync()
  expect(await bytes).toBe('original animated GIF')
})

it.each(['auto', 'gif'] as const)(
  'caches %s output as the actual GIF instead of keeping the static JPEG preview',
  async (format) => {
    vi.useRealTimers()
    const response = new Response()
    vi.spyOn(response, 'blob').mockResolvedValue(
      new Blob(['GIF89a'], { type: 'image/gif' })
    )
    vi.mocked(fetch).mockResolvedValue(response)
    const result = await cacheImageRecord(
      {
        id: 'gif-history',
        ownerId: 1,
        createdAt: 1,
        parameters: {
          ...defaultImageParameters,
          model: 'gpt-image-2.6-basic',
          format,
        },
        images: [
          {
            id: 'gif-1',
            src: 'https://images.example/cat.gif',
            previewSrc: 'data:image/jpeg;base64,cHJldmlldw==',
          },
        ],
        referenceCount: 0,
      },
      new AbortController().signal
    )
    expect(result.localSaveStatus).toBe('saved')
    expect(result.images[0].contentType).toBe('image/gif')
    expect(result.images[0].src).toBe('data:image/gif;base64,R0lGODlh')
    expect(result.images[0].previewSrc).toBeUndefined()
  }
)
