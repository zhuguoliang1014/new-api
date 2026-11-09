/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { t } from 'i18next'

import { api } from '@/lib/api'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'

import { getImageAuthScope } from '../api'
import type { ImageReference } from '../types'
import {
  creativePlanSchema,
  type CreativePlan,
  type CreativeTask,
} from './creative'

/** Analysis gets bounded previews; generation continues to use untouched files. */
export async function referenceAnalysisPreview(
  file: File,
  signal: AbortSignal
): Promise<string> {
  const src = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    signal.throwIfAborted()
    const scale = Math.min(
      1,
      1024 / Math.max(img.naturalWidth, img.naturalHeight)
    )
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error(t('Could not prepare reference previews.'))
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(src)
  }
}

export async function requestCreativePlan(
  input: {
    brief: string
    taskType: CreativeTask
    language: string
    references: ImageReference[]
  },
  signal: AbortSignal
): Promise<CreativePlan> {
  const scope = getImageAuthScope()
  if (!scope) throw new DOMException('Aborted', 'AbortError')
  const references = []
  for (const ref of input.references) {
    references.push({
      role: ref.role ?? 'subject',
      image: await referenceAnalysisPreview(ref.file, signal),
    })
  }
  signal.throwIfAborted()
  if (scope !== getImageAuthScope()) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const response = await api
    .post(
      '/api/image-playground/plan',
      {
        brief: input.brief,
        task_type: input.taskType,
        language: input.language,
        references,
      },
      { signal, skipAuthRefresh: true }
    )
    .catch((error: unknown) => {
      if (
        [
          'invalid creative brief',
          'invalid reference role',
          'invalid reference preview',
          'invalid creative plan response',
        ].includes(getServerErrorMessage(error))
      ) {
        throw new Error(t('Could not create a proposal. Your draft is kept.'))
      }
      throw error
    })
  if (scope !== getImageAuthScope()) {
    throw new DOMException('Aborted', 'AbortError')
  }
  signal.throwIfAborted()
  const result = creativePlanSchema.safeParse(
    (requireServerSuccess(response.data) as { data: unknown }).data
  )
  if (!result.success) {
    throw new Error(t('Could not create a proposal. Your draft is kept.'))
  }
  return result.data
}
