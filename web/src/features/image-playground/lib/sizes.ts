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
export const imageSizeValues = [
  'auto',
  '256x256',
  '512x512',
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '1792x1024',
  '1024x1792',
  '2048x2048',
  '2880x2880',
  '2160x1440',
  '3456x2304',
  '1440x2160',
  '2304x3456',
  '1280x720',
  '2560x1440',
  '3840x2160',
  '720x1280',
  '1440x2560',
  '2160x3840',
  '1024x768',
  '2048x1536',
  '3200x2400',
  '768x1024',
  '1536x2048',
  '2400x3200',
  '1280x544',
  '2560x1088',
  '3840x1600',
] as const

export type ImageSize = (typeof imageSizeValues)[number]
export type ImageResolution = '1K' | '2K' | '4K'
export const imageAspectPresets = [
  {
    ratio: '1:1',
    sizes: { '1K': '1024x1024', '2K': '2048x2048', '4K': '2880x2880' },
  },
  {
    ratio: '3:2',
    sizes: { '1K': '1536x1024', '2K': '2160x1440', '4K': '3456x2304' },
  },
  {
    ratio: '2:3',
    sizes: { '1K': '1024x1536', '2K': '1440x2160', '4K': '2304x3456' },
  },
  {
    ratio: '16:9',
    sizes: { '1K': '1280x720', '2K': '2560x1440', '4K': '3840x2160' },
  },
  {
    ratio: '9:16',
    sizes: { '1K': '720x1280', '2K': '1440x2560', '4K': '2160x3840' },
  },
  {
    ratio: '4:3',
    sizes: { '1K': '1024x768', '2K': '2048x1536', '4K': '3200x2400' },
  },
  {
    ratio: '3:4',
    sizes: { '1K': '768x1024', '2K': '1536x2048', '4K': '2400x3200' },
  },
  {
    ratio: '21:9',
    sizes: { '1K': '1280x544', '2K': '2560x1088', '4K': '3840x1600' },
  },
] as const satisfies readonly {
  ratio: string
  sizes: Record<ImageResolution, ImageSize>
}[]

export function getImageSizePreset(size: string): {
  preset: (typeof imageAspectPresets)[number]
  resolution: ImageResolution
} | null {
  for (const preset of imageAspectPresets) {
    for (const resolution of ['1K', '2K', '4K'] as const) {
      if (preset.sizes[resolution] === size) return { preset, resolution }
    }
  }
  return null
}

export function getImageAspectRatio(width: number, height: number): string {
  let divisor = width
  let remainder = height
  while (remainder) {
    const next = divisor % remainder
    divisor = remainder
    remainder = next
  }
  return `${width / divisor}:${height / divisor}`
}
