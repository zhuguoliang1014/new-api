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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from 'i18next'
import { nanoid } from 'nanoid'
import { useEffect, useRef } from 'react'

import {
  getServerErrorMessage,
  translateServerText,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  createStudioTask,
  listStudioTasks,
  getImageAuthScope,
  refinePrompt,
  type StudioTask,
} from '../api'
import { readImageHistory, saveImageRecord } from '../lib/history'
import { cacheImageRecord, getImageBlob } from '../lib/images'
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
export async function persistStudioRecord(
  record: ImageRecord,
  scope: string,
  signal: AbortSignal,
  existingOnly = false
): Promise<void> {
  let cached: ImageRecord | undefined
  try {
    cached = await cacheImageRecord(record, signal, (loaded, total) => {
      if (signal.aborted || scope !== getImageAuthScope()) return
      useImagePlaygroundStore.setState((state) => ({
        records: state.records.map((item) =>
          item.id === record.id
            ? { ...item, cacheProgress: { loaded, total } }
            : item
        ),
      }))
    })
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
    const savedRecord = cached
    useImagePlaygroundStore.setState((state) => ({
      storageUnavailable: false,
      records: state.records.map((item) =>
        item.id === record.id ? savedRecord : item
      ),
    }))
  } catch {
    if (signal.aborted || scope !== getImageAuthScope()) return
    useImagePlaygroundStore.setState((state) => ({
      storageUnavailable: true,
      records: state.records.map((item) =>
        item.id === record.id
          ? { ...(cached ?? item), localSaveStatus: 'failed' as const }
          : item
      ),
    }))
  }
}

export function useImageStudio() {
  const queryClient = useQueryClient()
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

  const tasks = useQuery({
    queryKey: ['image-studio-tasks', scope],
    queryFn: ({ signal }) => listStudioTasks(signal),
    enabled: Boolean(scope && ownerId && historyLoaded),
    refetchInterval: 2000,
    retry: 1,
    meta: { errorToast: false },
  })
  const taskCache = useRef({
    scope,
    controller: new AbortController(),
    attempted: new Set<string>(),
    queue: Promise.resolve(),
    downloads: Promise.resolve(),
  })
  useEffect(() => {
    const state = {
      scope,
      controller: new AbortController(),
      attempted: new Set<string>(),
      queue: Promise.resolve(),
      downloads: Promise.resolve(),
    }
    taskCache.current = state
    return () => state.controller.abort()
  }, [scope])
  useEffect(() => {
    useImagePlaygroundStore.setState({ taskSyncError: tasks.isError })
  }, [tasks.isError])
  useEffect(() => {
    if (
      !scope ||
      !ownerId ||
      !tasks.data ||
      taskCache.current.scope !== scope
    ) {
      return
    }
    const { controller, attempted } = taskCache.current
    const cacheTask = async (task: StudioTask) => {
      if (controller.signal.aborted || scope !== getImageAuthScope()) return
      const existing = useImagePlaygroundStore
        .getState()
        .records.find((item) => item.id === task.id)
      if (existing?.localSaveStatus === 'saved') return
      const images = await Promise.all(
        task.images.map(async (image) => {
          const src = `/api/image-playground/tasks/${task.id}/images/${image.index}`
          let previewSrc: string | undefined
          try {
            const blob = await getImageBlob(
              `${src}?thumbnail=1`,
              controller.signal
            )
            previewSrc = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.addEventListener(
                'load',
                () => resolve(String(reader.result)),
                { once: true }
              )
              reader.addEventListener('error', () => reject(reader.error), {
                once: true,
              })
              reader.readAsDataURL(blob)
            })
          } catch {
            /* Original caching can still succeed if the preview failed. */
          }
          return {
            id: `${task.id}-${image.index}`,
            src,
            previewSrc,
            width: image.width,
            height: image.height,
            bytes: image.bytes,
            contentType: image.content_type,
          }
        })
      )
      if (controller.signal.aborted || scope !== getImageAuthScope()) return
      const record: ImageRecord = {
        id: task.id,
        ownerId,
        createdAt: task.created_at,
        parameters: task.metadata.parameters,
        styleId: task.metadata.styleId,
        referenceCount: task.metadata.referenceCount,
        creativeContext: task.metadata.creativeContext,
        images,
        serverTask: true,
        expiresAt: task.expires_at * 1000,
        localSaveStatus: 'saving',
      }
      useImagePlaygroundStore.setState((state) => ({
        jobs: state.jobs.filter((item) => item.id !== task.id),
        records: [
          record,
          ...state.records.filter((item) => item.id !== task.id),
        ]
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 30),
      }))
      // Save server references first so failed browser caching remains recoverable.
      try {
        await saveImageRecord(record)
      } catch {
        /* Reported by the final save. */
      }
      taskCache.current.downloads = taskCache.current.downloads
        .then(async () => {
          if (controller.signal.aborted || scope !== getImageAuthScope()) return
          await persistStudioRecord(record, scope, controller.signal)
        })
        .catch(() => undefined)
    }
    useImagePlaygroundStore.setState((state) => ({
      jobs: [
        ...tasks.data
          .filter((task) => task.status !== 'ready')
          .map((task) => ({
            id: task.id,
            startedAt: task.created_at,
            controller,
            parameters: task.metadata.parameters,
            referenceCount: task.metadata.referenceCount,
            serverTask: true,
            status:
              task.status === 'failed' || task.status === 'ready'
                ? undefined
                : task.status,
            downloadImageIndex: task.download_image_index,
            downloadedBytes: task.downloaded_bytes,
            totalBytes: task.total_bytes,
            error: task.error ? t(task.error) : undefined,
          })),
        ...state.jobs.filter(
          (job) =>
            !job.serverTask && !tasks.data.some((task) => task.id === job.id)
        ),
      ],
    }))
    for (const task of tasks.data.filter((item) => item.status === 'ready')) {
      if (attempted.has(task.id)) continue
      attempted.add(task.id)
      taskCache.current.queue = taskCache.current.queue
        .then(() => cacheTask(task))
        .catch(() => undefined)
    }
  }, [tasks.data, scope, ownerId])

  const refineMutation = useMutation({
    retry: false,
    meta: { errorToast: false },
    mutationFn: ({ prompt, signal }: { prompt: string; signal: AbortSignal }) =>
      refinePrompt(prompt, signal),
  })

  const generationMutation = useMutation({
    retry: false,
    meta: { errorToast: false },
    mutationFn: async (
      parameters: ImageParameters & { requestPrompt?: string }
    ) => {
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
      const { requestPrompt, ...draftParameters } = parameters
      const creationParameters = normalizeImageParameters(draftParameters)
      const agentParameters = {
        ...creationParameters,
        prompt:
          requestPrompt ??
          (preset
            ? applyStyleTemplate(
                creationParameters.prompt,
                preset.promptTemplate
              )
            : creationParameters.prompt),
      }
      const controller = new AbortController()
      const job = {
        id: nanoid(),
        startedAt: Date.now(),
        controller,
        parameters: creationParameters,
        referenceCount: store.references.length,
        serverTask: false,
        status: 'submitting' as const,
      }
      const references = store.references.map((reference) => reference.file)
      useImagePlaygroundStore.setState((state) => ({
        jobs: [job, ...state.jobs],
        error: null,
      }))
      try {
        await createStudioTask(
          job.id,
          agentParameters,
          references,
          {
            parameters: creationParameters,
            styleId: preset?.id ?? null,
            referenceCount: references.length,
            creativeContext: store.creativeContext,
          },
          controller.signal
        )
        if (scope !== getImageAuthScope()) return
        useImagePlaygroundStore.setState((state) => ({
          jobs: state.jobs.map((item) =>
            item.id === job.id
              ? { ...item, serverTask: true, status: 'queued' as const }
              : item
          ),
        }))
        await queryClient.invalidateQueries({
          queryKey: ['image-studio-tasks', scope],
        })
      } catch (error) {
        if (
          scope !== getImageAuthScope() ||
          !useImagePlaygroundStore
            .getState()
            .jobs.some((item) => item.id === job.id)
        ) {
          return
        }
        let message = translateServerText(
          t,
          getServerErrorMessage(error, t('Image generation failed.'))
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
    generateAsync: generationMutation.mutateAsync,
  }
}
