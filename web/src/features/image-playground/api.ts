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
import { isAxiosError } from 'axios'
import { t } from 'i18next'
import { z } from 'zod'

import { api } from '@/lib/api'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { validateReferenceFiles } from './lib/images'
import {
  getImageModelOptions,
  getImageRequestFields,
  imageParametersSchema,
  normalizeImageParameters,
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

export type StudioGroup = {
  id: string
  name: string
  description: string
  ratio: number
  models: string[]
  max_resolution: number
  max_edge?: number
  max_pixels?: number
  size_mode: 'native' | 'upscale' | 'ratio'
  model_profiles?: Record<string, StudioModelProfile>
  available: boolean
}
export type StudioModelProfile = Pick<
  StudioGroup,
  'max_resolution' | 'max_edge' | 'max_pixels' | 'size_mode'
>

export function getStudioModelProfile(
  group: StudioGroup | undefined,
  model: string
): StudioModelProfile | undefined {
  return group?.model_profiles?.[model] ?? group
}
export async function getStudioGroups(): Promise<StudioGroup[]> {
  const response = await api.post(
    '/api/image-playground/bootstrap',
    {},
    { skipAuthRefresh: true }
  )
  const payload = requireServerSuccess(response.data) as { data: StudioGroup[] }
  return payload.data
}

const studioTaskSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{20,64}$/),
  status: z.enum([
    'queued',
    'generating',
    'downloading',
    'ready',
    'download_failed',
    'failed',
  ]),
  created_at: z.number(),
  expires_at: z.number(),
  metadata: z.object({
    parameters: imageParametersSchema,
    styleId: z.string().nullable(),
    referenceCount: z.number().int().min(0).max(4),
  }),
  images: z
    .array(
      z.object({
        index: z.number().int().min(0).max(3),
        width: z.number().positive(),
        height: z.number().positive(),
        bytes: z.number().nonnegative(),
        content_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      })
    )
    .max(4),
  download_image_index: z.number().int().nonnegative().optional(),
  downloaded_bytes: z.number().nonnegative(),
  total_bytes: z.number().nonnegative(),
  error: z.string().optional(),
})
export type StudioTask = z.infer<typeof studioTaskSchema>

export async function createStudioTask(
  id: string,
  parameters: ImageParameters,
  references: File[],
  metadata: StudioTask['metadata'],
  signal: AbortSignal
): Promise<StudioTask> {
  const parsed = imageParametersSchema.parse(parameters)
  const options = getImageModelOptions(parsed.model)
  if (!options.sizes.includes(parsed.size)) {
    throw new Error(t('This model does not support the selected image size.'))
  }
  if (parsed.count > options.maxCount) throw new Error(t('invalid image count'))
  if (options.isMidjourney && [...parsed.prompt].length > 1023) {
    throw new Error(t('Prompt is too long.'))
  }
  validateReferenceFiles(references)
  if (references.length && !options.supportsReferences) {
    throw new Error(t('Choose a model that supports reference images.'))
  }
  const scope = getImageAuthScope()
  if (!scope || signal.aborted) throw new DOMException('Aborted', 'AbortError')
  parameters = normalizeImageParameters(parsed)
  const fields = {
    ...getImageRequestFields(parameters),
    response_format: 'url',
  }
  let body: FormData | Record<string, unknown> = {
    ...fields,
    studio_metadata: metadata,
  }
  if (references.length && options.isMidjourney) {
    const images = await Promise.all(
      references.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.addEventListener(
              'load',
              () => resolve(String(reader.result)),
              { once: true }
            )
            reader.addEventListener('error', () => reject(reader.error), {
              once: true,
            })
            reader.readAsDataURL(file)
          })
      )
    )
    body = { ...fields, images, studio_metadata: metadata }
  } else if (references.length) {
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) {
      form.append(key, String(value))
    }
    form.append('studio_metadata', JSON.stringify(metadata))
    for (const file of references) form.append('image[]', file, file.name)
    body = form
  }
  if (signal.aborted || scope !== getImageAuthScope()) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const response = await api.post(
    `/api/image-playground/tasks/create/${references.length ? 'edits' : 'generations'}`,
    body,
    {
      signal,
      skipAuthRefresh: true,
      headers: {
        'X-Studio-Task-ID': id,
        'X-Studio-Group': encodeURIComponent(parameters.group ?? ''),
        'X-Studio-Model': parameters.model,
      },
    }
  )
  if (signal.aborted || scope !== getImageAuthScope()) {
    throw new DOMException('Aborted', 'AbortError')
  }
  return studioTaskSchema.parse(
    (requireServerSuccess(response.data) as { data: unknown }).data
  )
}

export async function listStudioTasks(
  signal: AbortSignal
): Promise<StudioTask[]> {
  const response = await api.get('/api/image-playground/tasks', { signal })
  return z
    .array(studioTaskSchema)
    .parse((requireServerSuccess(response.data) as { data: unknown }).data)
}

export async function retryStudioDownload(id: string): Promise<void> {
  await api.post(
    `/api/image-playground/tasks/${encodeURIComponent(id)}/retry-download`
  )
}

export async function deleteStudioTask(id: string): Promise<void> {
  try {
    await api.delete(`/api/image-playground/tasks/${encodeURIComponent(id)}`)
  } catch (error) {
    if (!isAxiosError(error) || error.response?.status !== 404) throw error
  }
}
