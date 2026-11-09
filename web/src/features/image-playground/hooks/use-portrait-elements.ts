/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { nanoid } from 'nanoid'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getImageAuthScope } from '../api'
import {
  getImageBlob,
  getImageExtension,
  validateReferenceFiles,
} from '../lib/images'
import {
  referenceForSlot,
  portraitLabels,
  poseViewLabels,
  type PortraitAsset,
  type PortraitSlot,
} from '../lib/portrait-elements'
import {
  selectedPortraitView,
  portraitAssetName,
  portraitViewName,
} from '../lib/reference-catalog'
import { trackStudioEvent } from '../lib/studio-events'
import { useImagePlaygroundStore } from '../store'
import { getImageModelOptions, type ImageReference } from '../types'

export function usePortraitElements(
  projectId: string,
  setBusy: (busy: boolean) => void
) {
  const { t, i18n } = useTranslation()
  const [loading, setLoading] = useState<string>()
  const [error, setError] = useState<string>()
  const pending = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      pending.current?.abort()
      setBusy(false)
    },
    [projectId, setBusy]
  )

  const apply = (
    role: PortraitSlot,
    file: File,
    asset?: Pick<
      ImageReference,
      'assetId' | 'assetView' | 'assetRole' | 'assetInstruction' | 'assetTitle'
    >
  ) => {
    const store = useImagePlaygroundStore.getState()
    const existing = referenceForSlot(store.references, role)
    const removed = store.references.filter(
      (r) => r.role === role || r.id === existing?.id
    )
    const next = store.references.filter((r) => !removed.includes(r))
    validateReferenceFiles(
      [...next.map((r) => r.file), file],
      getImageModelOptions(store.parameters.model).maxReferences
    )
    const added = {
      id: nanoid(),
      file,
      preview: URL.createObjectURL(file),
      role,
      ...asset,
    }
    const index = existing ? store.references.indexOf(existing) : next.length
    next.splice(index, 0, added)
    // Preserve the live blob URLs of every untouched reference.
    useImagePlaygroundStore.setState({ references: next })
    for (const ref of removed) URL.revokeObjectURL(ref.preview)
  }
  const choose = async (asset: PortraitAsset, viewId?: string) => {
    const view = selectedPortraitView(asset, viewId)
    const scope = getImageAuthScope()
    const controller = new AbortController()
    pending.current?.abort()
    pending.current = controller
    setBusy(true)
    setLoading(asset.id)
    setError(undefined)
    try {
      const blob = await getImageBlob(view?.src ?? asset.src, controller.signal)
      if (controller.signal.aborted || getImageAuthScope() !== scope) return
      const language = i18n.resolvedLanguage || i18n.language
      const displayName =
        portraitLabels(t)[asset.id] || portraitAssetName(asset, language)
      const angle =
        view && asset.role === 'pose'
          ? `-${portraitViewName(view, language, poseViewLabels(t))}${view.id.endsWith(':depth') ? `-${t('Depth map')}` : ''}`
          : ''
      const filename = `${displayName}${angle}`
        .replaceAll(/[\\/:*?"<>|]/g, '-')
        .slice(0, 100)
      apply(
        asset.role,
        new File([blob], `${filename}.${getImageExtension(blob.type)}`, {
          type: blob.type,
        }),
        {
          assetTitle: asset.displayTitle ??
            asset.title ?? { zh: displayName, en: displayName },
          assetId: asset.id,
          assetView: view?.id,
          assetRole: asset.role,
          assetInstruction: [asset.instruction, view?.instruction]
            .filter(Boolean)
            .join(' '),
        }
      )
      trackStudioEvent({
        action: 'reference_selected',
        mode: 'portrait',
        role: asset.role,
        asset_id: asset.id,
      })
      return true
    } catch {
      if (!controller.signal.aborted) {
        setError(t('Could not add this element. Your selection is unchanged.'))
      }
    } finally {
      if (pending.current === controller) {
        setLoading(undefined)
        setBusy(false)
      }
    }
  }
  const upload = (role: PortraitSlot, file: File) => {
    if (role === 'pose' || role === 'outfit') {
      setError(t('Choose poses and outfits from the built-in library.'))
      return false
    }
    pending.current?.abort()
    setBusy(false)
    setLoading(undefined)
    setError(undefined)
    try {
      apply(role, file)
      trackStudioEvent({ action: 'reference_selected', mode: 'portrait', role })
      return true
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t('Could not add this element. Your selection is unchanged.')
      )
    }
  }
  const remove = (role: PortraitSlot) => {
    pending.current?.abort()
    setBusy(false)
    setLoading(undefined)
    setError(undefined)
    const store = useImagePlaygroundStore.getState()
    const existing = referenceForSlot(store.references, role)
    for (const ref of store.references) {
      if (ref.role === role || ref.id === existing?.id) {
        store.removeReference(ref.id)
      }
    }
  }
  return { choose, upload, remove, loading, error }
}
