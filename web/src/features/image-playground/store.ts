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
import { nanoid } from 'nanoid'
import { create } from 'zustand'

import { useAuthStore } from '@/stores/auth-store'

import { validateReferenceFiles } from './lib/images'
import {
  defaultImageParameters,
  normalizeImageParameters,
  getImageModelOptions,
  type ImageJob,
  type ImageParameters,
  type ImageRecord,
  type ImageReference,
} from './types'

type ImagePlaygroundStore = {
  scope: string | null
  parameters: ImageParameters
  references: ImageReference[]
  records: ImageRecord[]
  selectedRecordId: string | null
  /** The id of the active style preset, or null for no style. */
  selectedStyleId: string | null
  jobs: ImageJob[]
  error: string | null
  storageUnavailable: boolean
  taskSyncError: boolean
  historyLoaded: boolean
  setScope: (scope: string | null) => void
  setParameters: (values: Partial<ImageParameters>) => void
  clearDraft: () => void
  addReferences: (files: File[]) => void
  removeReference: (id: string) => void
  reuseRecord: (record: ImageRecord) => void
}

export const useImagePlaygroundStore = create<ImagePlaygroundStore>(
  (set, get) => ({
    scope: null,
    parameters: defaultImageParameters,
    references: [],
    records: [],
    selectedRecordId: null,
    selectedStyleId: null,
    jobs: [],
    error: null,
    storageUnavailable: false,
    taskSyncError: false,
    historyLoaded: false,
    setScope: (scope) => {
      if (scope === get().scope) return
      for (const job of get().jobs) job.controller.abort()
      for (const reference of get().references) {
        URL.revokeObjectURL(reference.preview)
      }
      set({
        scope,
        parameters: defaultImageParameters,
        references: [],
        records: [],
        selectedRecordId: null,
        selectedStyleId: null,
        jobs: [],
        error: null,
        storageUnavailable: false,
        taskSyncError: false,
        historyLoaded: false,
      })
    },
    setParameters: (values) => {
      const state = get()
      const parameters = normalizeImageParameters({
        ...state.parameters,
        ...values,
      })
      const modelChanged =
        values.model !== undefined && values.model !== state.parameters.model
      if (
        modelChanged &&
        !getImageModelOptions(parameters.model).supportsReferences
      ) {
        for (const reference of state.references) {
          URL.revokeObjectURL(reference.preview)
        }
        set({ parameters, references: [] })
        return
      }
      set({ parameters })
    },
    clearDraft: () => {
      for (const reference of get().references) {
        URL.revokeObjectURL(reference.preview)
      }
      set((state) => ({
        parameters: { ...state.parameters, prompt: '' },
        references: [],
        selectedRecordId: null,
        selectedStyleId: null,
        error: null,
      }))
    },
    addReferences: (files) => {
      const combined = [
        ...get().references.map((reference) => reference.file),
        ...files,
      ]
      validateReferenceFiles(combined)
      set((state) => ({
        references: [
          ...state.references,
          ...files.map((file) => ({
            id: nanoid(),
            file,
            preview: URL.createObjectURL(file),
          })),
        ],
      }))
    },
    removeReference: (id) => {
      const reference = get().references.find((item) => item.id === id)
      if (reference) URL.revokeObjectURL(reference.preview)
      set((state) => ({
        references: state.references.filter((item) => item.id !== id),
      }))
    },
    reuseRecord: (record) => {
      for (const reference of get().references) {
        URL.revokeObjectURL(reference.preview)
      }
      set({
        parameters: normalizeImageParameters({
          ...record.parameters,
        }),
        references: [],
        selectedStyleId: record.styleId ?? null,
        error: null,
      })
    },
  })
)

// Local polling and drafts are cleared when the account changes. Server tasks
// continue and are recovered after the owner signs in again.
useAuthStore.subscribe((state) => {
  const auth = state.auth
  const scope =
    auth.user && auth.session ? `${auth.user.id}:${auth.session.sid}` : null
  useImagePlaygroundStore.getState().setScope(scope)
})

// Only an upload that has not yet been accepted can be lost on refresh.
function warnBeforeReload(event: BeforeUnloadEvent): void {
  event.preventDefault()
  event.returnValue = ''
}
useImagePlaygroundStore.subscribe((state) => {
  if (state.jobs.some((job) => !job.serverTask && !job.error)) {
    window.addEventListener('beforeunload', warnBeforeReload)
  } else window.removeEventListener('beforeunload', warnBeforeReload)
})
