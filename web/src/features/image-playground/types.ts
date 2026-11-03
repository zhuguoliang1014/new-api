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

import {
  getImageAspectRatio,
  getStudioSize,
  imageAspectPresets,
  imageSizeValues,
  upscaleSizes,
} from './lib/sizes'

const mjReferenceSchema = z
  .string()
  .max(8192)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        Boolean(url.hostname) &&
        !url.username &&
        !url.password
      )
    } catch {
      return false
    }
  })

export const midjourneyParametersSchema = z.object({
  raw: z.boolean().optional(),
  tile: z.boolean().optional(),
  negative_prompt: z.string().max(4000).optional(),
  seed: z.number().int().min(0).max(4294967295).optional(),
  stylize: z.number().int().min(0).max(1000).optional(),
  chaos: z.number().int().min(0).max(100).optional(),
  weird: z.number().int().min(0).max(3000).optional(),
  iw: z.number().min(0).max(3).optional(),
  cref: mjReferenceSchema.optional(),
  cw: z.number().int().min(0).max(100).optional(),
  sref: mjReferenceSchema.optional(),
  sw: z.number().int().min(0).max(1000).optional(),
  dref: mjReferenceSchema.optional(),
  dw: z.number().min(0).max(100).optional(),
})
export type MidjourneyParameters = z.infer<typeof midjourneyParametersSchema>

export const imageParametersSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, 'Describe the image you want to create.')
    .max(32000),
  model: z.string().trim().min(1, 'Select an image model.').max(200),
  size: z
    .string()
    .refine(
      (size) =>
        imageSizeValues.includes(size as never) ||
        /^(?:1:1|3:2|2:3|4:3|3:4|5:4|4:5|16:9|9:16|21:9|9:21)$/.test(size) ||
        /^\d{3,5}x\d{3,5}$/.test(size)
    ),
  group: z.string().optional(),
  mj: midjourneyParametersSchema.optional(),
  quality: z.enum(['auto', 'low', 'medium', 'high', 'standard', 'hd']),
  count: z.number().int().min(1).max(4),
  format: z.enum(['png', 'jpeg', 'webp']),
  background: z.enum(['auto', 'opaque', 'transparent']),
})

export type ImageParameters = z.infer<typeof imageParametersSchema>
export type ImageReference = { id: string; file: File; preview: string }
export type ImageOutput = {
  id: string
  src: string
  revisedPrompt?: string
  previewSrc?: string
  width?: number
  height?: number
  bytes?: number
}
export type ImageRecord = {
  id: string
  ownerId: number
  createdAt: number
  /** User-authored prompt and settings, without the built-in style template. */
  parameters: ImageParameters
  /** Undefined only for history saved before style and prompt were separated. */
  styleId?: string | null
  images: ImageOutput[]
  referenceCount: number
  serverTask?: boolean
  expiresAt?: number
  cacheProgress?: { loaded: number; total: number }
  localSaveStatus?: 'saving' | 'saved' | 'failed'
}
export type ImageJob = {
  id: string
  startedAt: number
  controller: AbortController
  parameters: ImageParameters
  referenceCount: number
  error?: string
  serverTask?: boolean
  status?:
    | 'submitting'
    | 'queued'
    | 'generating'
    | 'downloading'
    | 'download_failed'
  downloadImageIndex?: number
  downloadedBytes?: number
  totalBytes?: number
}

/** The image provider is an Agent implementation detail, not a user choice. */
export const AGENT_IMAGE_MODEL = 'gpt-image-2' as const

export const defaultImageParameters: ImageParameters = {
  prompt: '',
  // The Agent mode keeps the provider choice on the server. The fixed value
  // here is used only for local parameter normalization and history records.
  model: AGENT_IMAGE_MODEL,
  size: 'auto',
  quality: 'auto',
  count: 1,
  format: 'png',
  background: 'auto',
}

export function getImageModelOptions(model: string) {
  const isGptImage = /^gpt-image-/i.test(model)
  const isBanana = /^gemini-.*(?:image|banana)/i.test(model)
  const isMidjourney = model === 'mj-v8.2'
  const supportsFlexibleSizes = /^gpt-image-2(?:[.-]|$)/i.test(model)
  const isDalle3 = /^dall-e-3$/i.test(model)
  const isDalle2 = /^dall-e-2$/i.test(model)
  let sizes = ['auto', '1024x1024', '1536x1024', '1024x1536']
  if (supportsFlexibleSizes) {
    sizes = [
      'auto',
      ...imageAspectPresets.flatMap((preset) => Object.values(preset.sizes)),
      ...upscaleSizes,
    ]
  }
  if (isBanana) {
    sizes = [
      'auto',
      ...upscaleSizes.filter((size) =>
        size.split('x').every((edge) => Number(edge) <= 4096)
      ),
    ]
  }
  if (isMidjourney) {
    sizes = [
      'auto',
      ...imageAspectPresets.map((preset) => preset.ratio),
      '5:4',
      '4:5',
      '9:21',
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
    isBanana,
    isMidjourney,
    supportsFlexibleSizes,
    maxReferences: isMidjourney ? 5 : 4,
    sizes,
    qualities,
    maxCount: isDalle3 || isBanana || isMidjourney ? 1 : 4,
    supportsReferences: !isDalle2 && !isDalle3,
  }
}

export function normalizeImageParameters(
  parameters: ImageParameters
): ImageParameters {
  const options = getImageModelOptions(parameters.model)
  let size = options.sizes.includes(parameters.size) ? parameters.size : 'auto'
  const dimensions = /^(\d+)x(\d+)$/.exec(parameters.size)
  if (options.supportsFlexibleSizes && dimensions) {
    const width = Number(dimensions[1])
    const height = Number(dimensions[2])
    if (width > 4096 || height > 4096) {
      size = getStudioSize(getImageAspectRatio(width, height), '4K', 'upscale')
    }
  }
  return {
    ...parameters,
    size,
    mj: options.isMidjourney ? parameters.mj : undefined,
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

/** The same scalar fields feed both the relay request and its display estimate. */
export function getImageRequestFields(
  parameters: ImageParameters
): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {
    prompt: parameters.prompt,
    n: parameters.count,
  }
  const options = getImageModelOptions(parameters.model)
  if (!options.isBanana && !options.isMidjourney) {
    fields.quality = parameters.quality
    fields.output_format = parameters.format
  }
  if (options.isMidjourney && parameters.mj) {
    for (const [key, value] of Object.entries(parameters.mj)) {
      if (value !== undefined && value !== '') fields[key] = value
    }
  }
  if (parameters.size !== 'auto') fields.size = parameters.size
  if (options.isGptImage && parameters.background !== 'auto') {
    fields.background = parameters.background
  }
  return fields
}
