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
  job: ImageJob | null
  error: string | null
  storageUnavailable: boolean
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
    job: null,
    error: null,
    storageUnavailable: false,
    historyLoaded: false,
    setScope: (scope) => {
      if (scope === get().scope) return
      get().job?.controller.abort()
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
        job: null,
        error: null,
        storageUnavailable: false,
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

// Jobs survive route changes, but are cancelled and forgotten on logout/session
// changes. No revealed credential is stored in Zustand, Query or browser storage.
useAuthStore.subscribe((state) => {
  const auth = state.auth
  const scope =
    auth.user && auth.session ? `${auth.user.id}:${auth.session.sid}` : null
  useImagePlaygroundStore.getState().setScope(scope)
})

function warnBeforeReload(event: BeforeUnloadEvent): void {
  event.preventDefault()
  event.returnValue = ''
}

useImagePlaygroundStore.subscribe((state, previous) => {
  const pending =
    Boolean(state.job) ||
    state.records.some((record) => record.localSaveStatus === 'saving')
  const wasPending =
    Boolean(previous.job) ||
    previous.records.some((record) => record.localSaveStatus === 'saving')
  if (pending === wasPending) return
  if (pending) window.addEventListener('beforeunload', warnBeforeReload)
  else window.removeEventListener('beforeunload', warnBeforeReload)
})
