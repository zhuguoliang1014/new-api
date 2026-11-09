/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useEffect, useRef } from 'react'

import { useAuthStore } from '@/stores/auth-store'

import { getStudioModelProfile, type StudioGroup } from '../api'
import {
  readStudioModelPreference,
  studioDefaultModel,
} from '../lib/model-preference'
import { getStudioDefaultSize, getStudioSizeSelection } from '../lib/sizes'
import { useImagePlaygroundStore } from '../store'
import { getImageModelOptions } from '../types'

export function useCreativeModelSelection(groups: StudioGroup[] | undefined) {
  const ownerId = useAuthStore((s) => s.auth.user?.id)
  const initialized = useRef(false)
  const parameters = useImagePlaygroundStore((s) => s.parameters)
  const referenceCount = useImagePlaygroundStore((s) => s.references.length)
  const setParameters = useImagePlaygroundStore((s) => s.setParameters)
  useEffect(() => {
    if (!groups?.length) return
    const available = groups.filter((g) => g.available && g.models.length)
    if (!available.length) return
    let group = available.find((g) => g.id === parameters.group)
    let model = parameters.model
    if (!initialized.current && !parameters.group) {
      const preference = readStudioModelPreference(ownerId)
      const preferredGroup = available.find(
        (g) => g.id === preference?.group && g.models.includes(preference.model)
      )
      group =
        preferredGroup ??
        available.find((g) => g.models.includes(studioDefaultModel)) ??
        available[0]
      model = group.models.includes(studioDefaultModel)
        ? studioDefaultModel
        : group.models[0]
      if (preferredGroup && preference) model = preference.model
    } else if (!group || !group.models.includes(model)) {
      group =
        available.find((g) => g.models.includes(studioDefaultModel)) ??
        available[0]
      const compatible = model.replace(/-hq$/, '-basic')
      model = group.models.includes(studioDefaultModel)
        ? studioDefaultModel
        : group.models[0]
      if (group.models.includes(compatible)) model = compatible
    }
    if (!group) return
    if (
      referenceCount > getImageModelOptions(model).maxReferences ||
      (referenceCount > 0 && !getImageModelOptions(model).supportsReferences)
    ) {
      return
    }
    initialized.current = true
    if (group.id === parameters.group && model === parameters.model) return
    setParameters({
      group: group.id,
      model,
      size: getStudioDefaultSize(
        getStudioModelProfile(group, model) ?? group,
        getStudioSizeSelection(parameters.size, group.size_mode).ratio
      ),
    })
  }, [
    groups,
    ownerId,
    parameters.group,
    parameters.model,
    parameters.size,
    referenceCount,
    setParameters,
  ])
}
