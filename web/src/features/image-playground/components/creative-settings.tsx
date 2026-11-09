/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ModelSelector } from '@/components/model-group-selector'
import { Label } from '@/components/ui/label'
import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

import { getStudioModelProfile, type StudioGroup } from '../api'
import { saveStudioModelPreference } from '../lib/model-preference'
import { studioModelPresentation } from '../lib/model-presentation'
import { getStudioDefaultSize, getStudioSizeSelection } from '../lib/sizes'
import { useImagePlaygroundStore } from '../store'
import { getImageModelOptions } from '../types'
import { StudioCostEstimate } from './studio-cost-estimate'
import { StudioParameters } from './studio-parameters'

export function CreativeSettings(props: {
  group?: StudioGroup
  groups?: StudioGroup[]
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const ownerId = useAuthStore((s) => s.auth.user?.id)
  const parameters = useImagePlaygroundStore((s) => s.parameters)
  const [saveFailed, setSaveFailed] = useState(false)
  const options = (props.groups ?? [])
    .filter((g) => g.available)
    .flatMap((g) => g.models.map((model) => ({ group: g, model })))
  const order = (model: string) => {
    if (model.startsWith('gpt-')) return model.endsWith('-native') ? 1 : 0
    if (model.startsWith('gemini-')) return 2
    return 3
  }
  const unique = options
    .filter(
      (item, index) =>
        options.findIndex((x) => x.model === item.model) === index
    )
    .sort((a, b) => order(a.model) - order(b.model))
  const select = (model: string) => {
    const group =
      options.find((x) => x.model === model && x.group.id === parameters.group)
        ?.group ?? options.find((x) => x.model === model)?.group
    if (!group) return
    const references = useImagePlaygroundStore.getState().references
    const modelOptions = getImageModelOptions(model)
    if (
      references.length > modelOptions.maxReferences ||
      (references.length > 0 && !modelOptions.supportsReferences)
    ) {
      handleServerError(
        new Error(t('Choose a model that supports all selected references.'))
      )
      return
    }
    useImagePlaygroundStore.getState().setParameters({
      model,
      group: group.id,
      size: getStudioDefaultSize(
        getStudioModelProfile(group, model) ?? group,
        getStudioSizeSelection(
          parameters.size,
          (getStudioModelProfile(props.group, parameters.model) ?? props.group)
            ?.size_mode ?? group.size_mode
        ).ratio
      ),
    })
    setSaveFailed(
      !saveStudioModelPreference(ownerId, { model, group: group.id })
    )
  }
  return (
    <div className='studio-inline-model'>
      <div className='studio-inline-model-heading'>
        <Label htmlFor='creative-model'>{t('Generation model')}</Label>
      </div>
      <ModelSelector
        id='creative-model'
        presentation='field'
        selectedModel={parameters.model}
        onModelChange={select}
        disabled={props.disabled}
        models={unique.map(({ group, model }) => {
          const presentation = studioModelPresentation(model, t)
          return {
            value: model,
            ...presentation,
            menuLabel:
              presentation.category === 'GPT Image'
                ? presentation.name
                : presentation.label,
            price: (
              <StudioCostEstimate
                group={group}
                model={model}
                presentation='unit'
              />
            ),
          }
        })}
      />
      <StudioParameters
        group={props.group}
        presentation='compact'
        disabled={props.disabled}
      />
      {saveFailed && (
        <small role='status'>
          {t('Could not save your model preference.')}
        </small>
      )}
    </div>
  )
}
