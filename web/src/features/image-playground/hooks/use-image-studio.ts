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
      if (store.job || !ownerId || !scope || scope !== getImageAuthScope()) {
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
      useImagePlaygroundStore.setState({
        job,
        error: null,
        selectedRecordId: null,
      })
      try {
        const images = await generateImages(
          agentParameters,
          references,
          controller.signal
        )
        if (
          controller.signal.aborted ||
          scope !== getImageAuthScope() ||
          useImagePlaygroundStore.getState().job?.id !== job.id
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
        }
        useImagePlaygroundStore.setState((state) => ({
          records: [record, ...state.records].slice(0, 30),
          selectedRecordId: record.id,
          job: null,
        }))
        try {
          await saveImageRecord(record)
        } catch {
          if (scope === getImageAuthScope()) {
            useImagePlaygroundStore.setState({ storageUnavailable: true })
          }
        }
      } catch (error) {
        if (
          scope !== getImageAuthScope() ||
          useImagePlaygroundStore.getState().job?.id !== job.id
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
        useImagePlaygroundStore.setState({ job: null, error: message })
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
