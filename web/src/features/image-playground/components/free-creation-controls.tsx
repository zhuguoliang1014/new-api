/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useTranslation } from 'react-i18next'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import type { CreativeWorkspaceState } from '../hooks/use-creative-workspace'
import { trackStudioEvent } from '../lib/studio-events'
import { useImagePlaygroundStore } from '../store'
import { getImageModelOptions } from '../types'
import { StudioReferences } from './studio-references'

export function FreeCreationControls(props: { state: CreativeWorkspaceState }) {
  const { t } = useTranslation()
  const parameters = useImagePlaygroundStore((s) => s.parameters)
  const model = getImageModelOptions(parameters.model)
  const disabled =
    props.state.executing ||
    props.state.selectingElements ||
    props.state.planning
  const add = (files: File[]) => {
    if (disabled) return
    try {
      useImagePlaygroundStore.getState().addReferences(files)
      trackStudioEvent({
        action: 'reference_selected',
        mode: 'general',
        role: 'subject',
      })
    } catch (error) {
      handleServerError(error)
    }
  }
  return (
    <>
      <section className='compose-brief-section compose-free-brief'>
        <Label className='sr-only' htmlFor='shoot-brief'>
          {t('What would you like to create?')}
        </Label>
        <Textarea
          id='shoot-brief'
          rows={4}
          maxLength={4000}
          disabled={disabled}
          value={props.state.brief}
          onChange={(e) => props.state.setBrief(e.target.value)}
          placeholder={t(
            'Describe a new image, or tell us what to change in your reference.'
          )}
        />
      </section>
      <section
        className='compose-free-references'
        onPaste={(e) => {
          if (e.clipboardData.files.length) {
            e.preventDefault()
            add([...e.clipboardData.files])
          }
        }}
      >
        <div className='compose-section-heading'>
          <h3>{t('Reference images')}</h3>
          <span>{t('Optional')}</span>
        </div>
        <StudioReferences
          maxReferences={model.maxReferences}
          supportsReferences={model.supportsReferences}
          disabled={disabled}
          onAddFiles={add}
        />
      </section>
    </>
  )
}
