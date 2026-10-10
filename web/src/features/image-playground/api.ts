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
import axios from 'axios'
import { t } from 'i18next'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import { fetchTokenKey } from '@/features/keys/api'
import {
  createServerError,
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { validateReferenceFiles } from './lib/images'
import {
  getImageModelOptions,
  imageParametersSchema,
  normalizeImageParameters,
  type ImageOutput,
  type ImageParameters,
} from './types'

// Relay requests use the selected API token, never the dashboard access token.
// A separate client also prevents the dashboard's 401 refresh/replay interceptor
// from resubmitting a billable image request with different credentials.
export const imageRelayClient = axios.create({
  baseURL: '/v1',
  withCredentials: false,
  headers: { 'Cache-Control': 'no-store' },
})

export function getImageAuthScope(): string | null {
  const auth = useAuthStore.getState().auth
  return auth.user && auth.session
    ? `${auth.user.id}:${auth.session.sid}`
    : null
}

async function resolveImageCredential(
  keyId: number,
  signal: AbortSignal
): Promise<string> {
  const scope = getImageAuthScope()
  if (!scope || signal.aborted) throw new DOMException('Aborted', 'AbortError')
  const response = await fetchTokenKey(keyId, signal)
  if (signal.aborted || scope !== getImageAuthScope()) {
    throw new DOMException('Aborted', 'AbortError')
  }
  requireServerSuccess(response)
  const key = response.data?.key
  if (!key) throw new Error(t('Failed to load API key.'))
  return key.startsWith('sk-') ? key : `sk-${key}`
}

const modelsResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      supported_endpoint_types: z.array(z.string()).optional(),
    })
  ),
})

export async function getImageModels(
  keyId: number,
  signal: AbortSignal
): Promise<string[]> {
  const credential = await resolveImageCredential(keyId, signal)
  try {
    const response = await imageRelayClient.get('/models', {
      headers: { Authorization: `Bearer ${credential}` },
      signal,
    })
    const payload = modelsResponseSchema.parse(response.data)
    return payload.data
      .filter(
        (model) =>
          model.supported_endpoint_types?.includes('image-generation') ||
          (!model.supported_endpoint_types?.length &&
            /gpt-image|dall-e|flux|imagen|ideogram|stable-diffusion/i.test(
              model.id
            ))
      )
      .map((model) => model.id)
      .sort((a, b) => {
        if (a === 'gpt-image-2') return -1
        if (b === 'gpt-image-2') return 1
        return a.localeCompare(b)
      })
  } catch (error) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    throw new Error(
      getServerErrorMessage(error, t('Failed to load image models.'))
        .split(credential)
        .join('[redacted]')
    )
  }
}

const imageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().optional(),
        url: z.string().optional(),
        revised_prompt: z.string().optional(),
      })
    )
    .min(1),
  output_format: z.enum(['png', 'jpeg', 'webp']).optional(),
})

export async function generateImages(
  keyId: number,
  input: ImageParameters,
  references: File[],
  signal: AbortSignal
): Promise<ImageOutput[]> {
  // The workbench deliberately offers 1–4 images; server dto.MaxImageN (128)
  // remains the canonical security and accounting bound for every API caller.
  const parsed = imageParametersSchema.parse(input)
  const options = getImageModelOptions(parsed.model)
  // Never silently downgrade an explicit resolution before a billable request.
  if (!options.sizes.includes(parsed.size)) {
    throw new Error(t('This model does not support the selected image size.'))
  }
  const parameters = normalizeImageParameters(parsed)
  validateReferenceFiles(references)
  if (references.length && !options.supportsReferences) {
    throw new Error(t('Choose a model that supports reference images.'))
  }
  const scope = getImageAuthScope()
  const credential = await resolveImageCredential(keyId, signal)
  const fields: Record<string, string | number> = {
    model: parameters.model,
    prompt: parameters.prompt,
    n: parameters.count,
  }
  if (parameters.size !== 'auto') fields.size = parameters.size
  if (parameters.quality !== 'auto') fields.quality = parameters.quality
  if (options.isGptImage) {
    // Explicit auto avoids the legacy GPT Image 1 edit default of standard.
    fields.quality = parameters.quality
    fields.output_format = parameters.format
    if (parameters.background !== 'auto') {
      fields.background = parameters.background
    }
  } else if (/^dall-e-/i.test(parameters.model)) {
    fields.response_format = 'b64_json'
  }
  let body: FormData | typeof fields = fields
  if (references.length) {
    body = new FormData()
    for (const [name, value] of Object.entries(fields)) {
      body.append(name, String(value))
    }
    for (const file of references) body.append('image[]', file, file.name)
  }
  try {
    const response = await imageRelayClient.post(
      references.length ? '/images/edits' : '/images/generations',
      body,
      {
        headers: { Authorization: `Bearer ${credential}` },
        signal,
      }
    )
    if (scope !== getImageAuthScope() || signal.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    if (response.data?.error || response.data?.success === false) {
      throw createServerError(response.data)
    }
    const payload = imageResponseSchema.safeParse(response.data)
    if (!payload.success) {
      throw new Error(t('The API did not return any usable images.'))
    }
    return payload.data.data.map((item) => {
      let src = item.url ?? ''
      if (item.b64_json) {
        let mime = payload.data.output_format ?? parameters.format
        // Several compatible providers return PNG even when JPEG is requested.
        const base64 = item.b64_json.split(/\s/).join('')
        if (base64.startsWith('iVBORw0KGgo')) mime = 'png'
        if (base64.startsWith('/9j/')) mime = 'jpeg'
        if (base64.startsWith('UklGR')) mime = 'webp'
        src = `data:image/${mime};base64,${base64}`
      }
      if (
        !/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(src) &&
        !/^https?:\/\//i.test(src)
      ) {
        throw new Error(t('The API did not return any usable images.'))
      }
      return { id: nanoid(), src, revisedPrompt: item.revised_prompt }
    })
  } catch (error) {
    if (signal.aborted || scope !== getImageAuthScope()) {
      throw new DOMException('Aborted', 'AbortError')
    }
    throw new Error(
      getServerErrorMessage(error, t('Image generation failed.'))
        .split(credential)
        .join('[redacted]')
    )
  }
}
