/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { t } from 'i18next'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import { api } from '@/lib/api'
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

// Image requests use the authenticated playground session. The API instance
// supplies the current session bearer and cookie without exposing a user key to
// the browser. Disabling automatic auth replay is deliberate: image creation
// can be billable, so a 401 must never be replayed automatically.
export const imageRelayClient = api

export type PlaygroundAgentSelection = {
  token_id: number
  model: string
}

export type PlaygroundAgentConfig = {
  prompt: PlaygroundAgentSelection | null
  image: PlaygroundAgentSelection | null
}

export async function getPlaygroundAgentConfig(): Promise<PlaygroundAgentConfig> {
  const response = await api.get('/api/image-playground/settings')
  const payload = requireServerSuccess(response.data) as {
    data?: {
      prompt?: PlaygroundAgentSelection | null
      image?: PlaygroundAgentSelection | null
    }
  }
  const data = payload.data ?? {}
  return {
    prompt: data.prompt ?? null,
    image: data.image ?? null,
  }
}

export async function savePlaygroundAgentConfig(
  config: PlaygroundAgentConfig
): Promise<PlaygroundAgentConfig> {
  const response = await api.put('/api/image-playground/settings', config)
  const payload = requireServerSuccess(response.data) as {
    data?: {
      prompt?: PlaygroundAgentSelection | null
      image?: PlaygroundAgentSelection | null
    }
  }
  const data = payload.data ?? {}
  return {
    prompt: data.prompt ?? null,
    image: data.image ?? null,
  }
}

export function getImageAuthScope(): string | null {
  const auth = useAuthStore.getState().auth
  return auth.user && auth.session
    ? `${auth.user.id}:${auth.session.sid}`
    : null
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

const refineResponseSchema = z.object({ prompt: z.string().trim().min(1) })

type PlaygroundRequestConfig = {
  signal?: AbortSignal
  skipErrorHandler: true
  skipAuthRefresh: true
}

const requestConfig = (signal?: AbortSignal): PlaygroundRequestConfig => ({
  signal,
  skipErrorHandler: true,
  skipAuthRefresh: true,
})

function getRefinedPrompt(value: unknown): string {
  const response = requireServerSuccess(value)
  const parsed = refineResponseSchema.safeParse(response)
  if (parsed.success) return parsed.data.prompt

  if (typeof response !== 'object' || response === null) {
    throw new Error(t('The prompt service returned an invalid response.'))
  }
  const payload = response as Record<string, unknown>
  const nested = payload.data
  const nestedPrompt =
    typeof nested === 'object' && nested !== null
      ? (nested as Record<string, unknown>).prompt
      : undefined
  if (typeof nestedPrompt === 'string' && nestedPrompt.trim()) {
    return nestedPrompt.trim()
  }

  // Keep compatibility with an OpenAI-compatible chat response in case the
  // backend delegates directly to a text model instead of wrapping it.
  const choices =
    typeof nested === 'object' && nested !== null
      ? (nested as Record<string, unknown>).choices
      : undefined
  const message = Array.isArray(choices) ? choices[0] : undefined
  const content =
    typeof message === 'object' && message !== null
      ? (message as Record<string, unknown>).message
      : undefined
  const text =
    typeof content === 'object' && content !== null
      ? (content as Record<string, unknown>).content
      : undefined
  if (typeof text === 'string' && text.trim()) return text.trim()

  throw new Error(t('The prompt service returned an invalid response.'))
}

/** Ask the server-side studio agent to turn a plain-language idea into a production prompt. */
export async function refinePrompt(
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const value = prompt.trim()
  if (!value) throw new Error(t('Describe the image you want to create.'))
  if (value.length > 32000) {
    throw new Error(t('Prompt is too long.'))
  }
  const scope = getImageAuthScope()
  if (!scope || signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  try {
    const response = await imageRelayClient.post(
      '/api/image-playground/refine-prompt',
      { prompt: value },
      requestConfig(signal)
    )
    if (scope !== getImageAuthScope() || signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    return getRefinedPrompt(response.data)
  } catch (error) {
    if (signal?.aborted || scope !== getImageAuthScope()) {
      throw new DOMException('Aborted', 'AbortError')
    }
    throw new Error(
      getServerErrorMessage(error, t('Prompt refinement failed.')),
      { cause: error }
    )
  }
}

function getImageOutput(
  item: z.infer<typeof imageResponseSchema>['data'][number],
  outputFormat: 'png' | 'jpeg' | 'webp'
): ImageOutput {
  let src = item.url ?? ''
  if (item.b64_json) {
    let mime = outputFormat
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
}

/**
 * Generate images through the session-scoped playground route.
 *
 * The backend resolves the selected API key and model. The model remains in
 * the local draft so parameter capabilities and history stay accurate.
 */
export async function generateImages(
  input: ImageParameters,
  references: File[],
  signal: AbortSignal
): Promise<ImageOutput[]>
/** @deprecated Kept as a source-compatible shim for integrations that passed a key id. */
export async function generateImages(
  _ignoredKeyId: number,
  input: ImageParameters,
  references: File[],
  signal: AbortSignal
): Promise<ImageOutput[]>
export async function generateImages(
  first: ImageParameters | number,
  second: ImageParameters | File[],
  third: File[] | AbortSignal,
  fourth?: AbortSignal
): Promise<ImageOutput[]> {
  const input = typeof first === 'number' ? (second as ImageParameters) : first
  const references = (typeof first === 'number' ? third : second) as File[]
  const signal = (typeof first === 'number' ? fourth : third) as AbortSignal

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
  if (!scope || signal.aborted) throw new DOMException('Aborted', 'AbortError')

  const fields: Record<string, string | number> = {
    prompt: parameters.prompt,
    n: parameters.count,
    quality: parameters.quality,
    output_format: parameters.format,
  }
  if (parameters.size !== 'auto') fields.size = parameters.size
  if (parameters.background !== 'auto') {
    fields.background = parameters.background
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
      references.length ? '/pg/images/edits' : '/pg/images/generations',
      body,
      requestConfig(signal)
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
    return payload.data.data.map((item) =>
      getImageOutput(item, payload.data.output_format ?? parameters.format)
    )
  } catch (error) {
    if (signal.aborted || scope !== getImageAuthScope()) {
      throw new DOMException('Aborted', 'AbortError')
    }
    throw new Error(
      getServerErrorMessage(error, t('Image generation failed.')),
      {
        cause: error,
      }
    )
  }
}
