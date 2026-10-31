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
import { useMutation } from '@tanstack/react-query'
import { t } from 'i18next'
import { nanoid } from 'nanoid'
import { useEffect, useRef } from 'react'

import { getServerErrorMessage } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { generateImages, getImageAuthScope, refinePrompt } from '../api'
import { readImageHistory, saveImageRecord } from '../lib/history'
import { cacheImageRecord } from '../lib/images'
import {
  applyStyleTemplate,
  restoreLegacyStyleRecord,
  stylePresets,
} from '../lib/style-presets'
import { useImagePlaygroundStore } from '../store'
import {
  normalizeImageParameters,
  type ImageParameters,
  type ImageRecord,
} from '../types'

// Both new creations and legacy URL records use the same local-save path.
async function persistStudioRecord(
  record: ImageRecord,
  scope: string,
  signal: AbortSignal,
  existingOnly = false
): Promise<void> {
  try {
    const cached = await cacheImageRecord(record, signal)
    if (
      signal.aborted ||
      scope !== getImageAuthScope() ||
      !useImagePlaygroundStore
        .getState()
        .records.some((item) => item.id === record.id)
    ) {
      return
    }
    if (existingOnly) await saveImageRecord(cached, true)
    else await saveImageRecord(cached)
    if (signal.aborted || scope !== getImageAuthScope()) return
    useImagePlaygroundStore.setState((state) => ({
      records: state.records.map((item) =>
        item.id === record.id ? cached : item
      ),
    }))
  } catch {
    if (signal.aborted || scope !== getImageAuthScope()) return
    useImagePlaygroundStore.setState((state) => ({
      storageUnavailable: true,
      records: state.records.map((item) =>
        item.id === record.id
          ? { ...item, localSaveStatus: 'failed' as const }
          : item
      ),
    }))
  }
}

export function useImageStudio() {
  const refineControllerRef = useRef<AbortController | null>(null)
  const scope = useAuthStore((state) =>
    state.auth.user && state.auth.session
      ? `${state.auth.user.id}:${state.auth.session.sid}`
      : null
  )
  const ownerId = useAuthStore((state) => state.auth.user?.id)
  const historyLoaded = useImagePlaygroundStore((state) => state.historyLoaded)
  useEffect(() => {
    // Prompt refinement is session-bound too. Abort an in-flight request when
    // the account changes so a late response cannot update a new session's
    // composer, even if the previous route remains mounted for a frame.
    refineControllerRef.current?.abort()
    refineControllerRef.current = null
    useImagePlaygroundStore.getState().setScope(scope)

    return () => {
      refineControllerRef.current?.abort()
      refineControllerRef.current = null
    }
  }, [scope])

  useEffect(() => {
    if (!ownerId || !scope || historyLoaded) return
    let active = true
    readImageHistory(ownerId)
      .then((records) => {
        if (!active || scope !== getImageAuthScope()) return
        useImagePlaygroundStore.setState((state) => ({
          records: [
            ...state.records,
            ...records
              .filter(
                (record) => !state.records.some((item) => item.id === record.id)
              )
              .map(restoreLegacyStyleRecord),
          ]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 30),
          historyLoaded: true,
        }))
      })
      .catch(() => {
        if (active && scope === getImageAuthScope()) {
          useImagePlaygroundStore.setState({
            storageUnavailable: true,
            historyLoaded: true,
          })
        }
      })
    return () => {
      active = false
    }
  }, [scope, ownerId, historyLoaded])

  useEffect(() => {
    if (!scope || !historyLoaded) return
    const controller = new AbortController()
    // Process records in order and only fetch the images within one creation
    // concurrently, rather than downloading the entire history at once.
    const records = useImagePlaygroundStore
      .getState()
      .records.filter((record) =>
        record.images.some((image) => /^https?:/i.test(image.src))
      )
    void (async () => {
      for (const record of records) {
        if (controller.signal.aborted || scope !== getImageAuthScope()) return
        if (
          !useImagePlaygroundStore
            .getState()
            .records.some((item) => item.id === record.id)
        ) {
          continue
        }
        useImagePlaygroundStore.setState((state) => ({
          records: state.records.map((item) =>
            item.id === record.id
              ? { ...item, localSaveStatus: 'saving' as const }
              : item
          ),
        }))
        await persistStudioRecord(record, scope, controller.signal, true)
      }
    })()
    return () => {
      controller.abort()
      useImagePlaygroundStore.setState((state) => ({
        records: state.records.map((record) =>
          record.localSaveStatus === 'saving' &&
          records.some((item) => item.id === record.id)
            ? { ...record, localSaveStatus: 'failed' as const }
            : record
        ),
      }))
    }
  }, [scope, historyLoaded])

  const refineMutation = useMutation({
    retry: false,
    meta: { errorToast: false },
    mutationFn: ({ prompt, signal }: { prompt: string; signal: AbortSignal }) =>
      refinePrompt(prompt, signal),
  })

  const generationMutation = useMutation({
    retry: false,
    meta: { errorToast: false },
    mutationFn: async (parameters: ImageParameters) => {
      const store = useImagePlaygroundStore.getState()
      if (
        store.jobs.filter((job) => !job.error).length >= 4 ||
        !ownerId ||
        !scope ||
        scope !== getImageAuthScope()
      ) {
        return
      }
      // Keep the user's draft and style separate; expand the template only for
      // the provider request, never for history, copying, or continued editing.
      const preset = stylePresets.find(
        (item) => item.id === store.selectedStyleId
      )
      const creationParameters = normalizeImageParameters(parameters)
      const agentParameters = {
        ...creationParameters,
        prompt: preset
          ? applyStyleTemplate(creationParameters.prompt, preset.promptTemplate)
          : creationParameters.prompt,
      }
      const controller = new AbortController()
      const job = {
        id: nanoid(),
        startedAt: Date.now(),
        controller,
        parameters: creationParameters,
        referenceCount: store.references.length,
      }
      const references = store.references.map((reference) => reference.file)
      useImagePlaygroundStore.setState((state) => ({
        jobs: [job, ...state.jobs],
        error: null,
      }))
      try {
        const images = await generateImages(
          agentParameters,
          references,
          controller.signal
        )
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError')
        }
        if (
          scope !== getImageAuthScope() ||
          !useImagePlaygroundStore
            .getState()
            .jobs.some((item) => item.id === job.id)
        ) {
          return
        }
        const record: ImageRecord = {
          id: job.id,
          ownerId,
          createdAt: Date.now(),
          parameters: creationParameters,
          styleId: preset?.id ?? null,
          images,
          referenceCount: references.length,
          localSaveStatus: 'saving',
        }
        useImagePlaygroundStore.setState((state) => ({
          records: [record, ...state.records].slice(0, 30),
          selectedRecordId: state.selectedRecordId ?? record.id,
        }))
        await persistStudioRecord(record, scope, controller.signal)
        if (
          scope === getImageAuthScope() &&
          useImagePlaygroundStore
            .getState()
            .jobs.some((item) => item.id === job.id)
        ) {
          useImagePlaygroundStore.setState((state) => ({
            jobs: state.jobs.filter((item) => item.id !== job.id),
          }))
        }
      } catch (error) {
        if (
          scope !== getImageAuthScope() ||
          !useImagePlaygroundStore
            .getState()
            .jobs.some((item) => item.id === job.id)
        ) {
          return
        }
        let message = getServerErrorMessage(
          error,
          t('Image generation failed.')
        )
        if (controller.signal.aborted) {
          message = t(
            'Stopped waiting. The provider may still finish and charge for this request.'
          )
        }
        useImagePlaygroundStore.setState((state) => ({
          jobs: state.jobs.map((item) =>
            item.id === job.id ? { ...item, error: message } : item
          ),
        }))
      }
    },
  })

  return {
    refine: async (prompt: string) => {
      const controller = new AbortController()
      refineControllerRef.current?.abort()
      refineControllerRef.current = controller
      try {
        const refined = await refineMutation.mutateAsync({
          prompt,
          signal: controller.signal,
        })
        if (controller.signal.aborted || scope !== getImageAuthScope()) {
          throw new DOMException('Aborted', 'AbortError')
        }
        return refined
      } finally {
        if (refineControllerRef.current === controller) {
          refineControllerRef.current = null
        }
      }
    },
    refining: refineMutation.isPending,
    refineError: refineMutation.error,
    generate: generationMutation.mutate,
  }
}
