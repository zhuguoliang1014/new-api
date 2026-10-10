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
import { z } from 'zod'

import { imageAspectPresets, imageSizeValues } from './lib/sizes'

export const imageParametersSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, 'Describe the image you want to create.')
    .max(32000),
  model: z.string().trim().min(1, 'Select an image model.').max(200),
  size: z.enum(imageSizeValues),
  quality: z.enum(['auto', 'low', 'medium', 'high', 'standard', 'hd']),
  count: z.number().int().min(1).max(4),
  format: z.enum(['png', 'jpeg', 'webp']),
  background: z.enum(['auto', 'opaque', 'transparent']),
})

export type ImageParameters = z.infer<typeof imageParametersSchema>
export type ImageReference = { id: string; file: File; preview: string }
export type ImageOutput = { id: string; src: string; revisedPrompt?: string }
export type ImageRecord = {
  id: string
  ownerId: number
  createdAt: number
  parameters: ImageParameters
  images: ImageOutput[]
  referenceCount: number
}
export type ImageJob = {
  id: string
  startedAt: number
  controller: AbortController
  parameters: ImageParameters
  referenceCount: number
}
export const defaultImageParameters: ImageParameters = {
  prompt: '',
  model: '',
  size: 'auto',
  quality: 'auto',
  count: 1,
  format: 'png',
  background: 'auto',
}

export function getImageModelOptions(model: string) {
  const isGptImage = /^gpt-image-/i.test(model)
  const supportsFlexibleSizes = /^gpt-image-2(?:[.-]|$)/i.test(model)
  const isDalle3 = /^dall-e-3$/i.test(model)
  const isDalle2 = /^dall-e-2$/i.test(model)
  let sizes = ['auto', '1024x1024', '1536x1024', '1024x1536']
  if (supportsFlexibleSizes) {
    sizes = [
      'auto',
      ...imageAspectPresets.flatMap((preset) => Object.values(preset.sizes)),
    ]
  }
  let qualities = ['auto']
  if (isGptImage) qualities = ['auto', 'low', 'medium', 'high']
  if (isDalle3) {
    sizes = ['auto', '1024x1024', '1792x1024', '1024x1792']
    qualities = ['auto', 'standard', 'hd']
  }
  if (isDalle2) sizes = ['auto', '256x256', '512x512', '1024x1024']
  return {
    isGptImage,
    supportsFlexibleSizes,
    sizes,
    qualities,
    maxCount: isDalle3 ? 1 : 4,
    supportsReferences: !isDalle2 && !isDalle3,
  }
}

export function normalizeImageParameters(
  parameters: ImageParameters
): ImageParameters {
  const options = getImageModelOptions(parameters.model)
  return {
    ...parameters,
    size: options.sizes.includes(parameters.size) ? parameters.size : 'auto',
    quality: options.qualities.includes(parameters.quality)
      ? parameters.quality
      : 'auto',
    count: Math.min(parameters.count, options.maxCount),
    format: options.isGptImage ? parameters.format : 'png',
    background:
      options.isGptImage && parameters.format !== 'jpeg'
        ? parameters.background
        : 'auto',
  }
}
