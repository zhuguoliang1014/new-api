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
import { useMutation, useQuery } from '@tanstack/react-query'
import { t } from 'i18next'
import { nanoid } from 'nanoid'
import { useEffect } from 'react'

import { getApiKeys } from '@/features/keys/api'
import {
  getServerErrorMessage,
  requireServerSuccess,
} from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import { generateImages, getImageAuthScope, getImageModels } from '../api'
import { readImageHistory, saveImageRecord } from '../lib/history'
import { useImagePlaygroundStore } from '../store'
import type { ImageParameters, ImageRecord } from '../types'

export function useImageStudio() {
  const scope = useAuthStore((state) =>
    state.auth.user && state.auth.session
      ? `${state.auth.user.id}:${state.auth.session.sid}`
      : null
  )
  const ownerId = useAuthStore((state) => state.auth.user?.id)
  const selectedKeyId = useImagePlaygroundStore((state) => state.selectedKeyId)
  const historyLoaded = useImagePlaygroundStore((state) => state.historyLoaded)
  useEffect(() => {
    useImagePlaygroundStore.getState().setScope(scope)
  }, [scope])

  const keysQuery = useQuery({
    queryKey: ['image-studio', scope, 'keys'],
    queryFn: async () => requireServerSuccess(await getApiKeys({ size: 100 })),
    enabled: Boolean(scope),
  })
  const keys = (keysQuery.data?.data?.items ?? []).filter(
    (key) =>
      key.status === 1 &&
      (key.unlimited_quota || key.remain_quota > 0) &&
      (key.expired_time === -1 || key.expired_time > Date.now() / 1000)
  )
  const keyId = keys.some((key) => key.id === selectedKeyId)
    ? selectedKeyId
    : (keys[0]?.id ?? null)
  const modelsQuery = useQuery({
    queryKey: ['image-studio', scope, 'models', keyId],
    queryFn: ({ signal }) =>
      keyId ? getImageModels(keyId, signal) : Promise.resolve([]),
    enabled: Boolean(keyId && scope),
    retry: false,
    meta: { errorToast: false },
  })
  useEffect(() => {
    if (!modelsQuery.data?.length) return
    const store = useImagePlaygroundStore.getState()
    if (!store.parameters.model) {
      store.setParameters({ model: modelsQuery.data[0] })
    }
  }, [modelsQuery.data])

  useEffect(() => {
    if (!ownerId || !scope || historyLoaded) return
    let active = true
    readImageHistory(ownerId)
      .then((records) => {
        if (!active || scope !== getImageAuthScope()) return
        useImagePlaygroundStore.setState((state) => ({
          records: [
            ...state.records,
            ...records.filter(
              (record) => !state.records.some((item) => item.id === record.id)
            ),
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

  const mutation = useMutation({
    retry: false,
    meta: { errorToast: false },
    mutationFn: async (parameters: ImageParameters) => {
      const store = useImagePlaygroundStore.getState()
      if (
        store.job ||
        !keyId ||
        !ownerId ||
        !scope ||
        scope !== getImageAuthScope()
      ) {
        return
      }
      const controller = new AbortController()
      const job = {
        id: nanoid(),
        startedAt: Date.now(),
        controller,
        parameters,
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
          keyId,
          parameters,
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
          parameters,
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
  return { keys, keysQuery, keyId, modelsQuery, generate: mutation.mutate }
}
