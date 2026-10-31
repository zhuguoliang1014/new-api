/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Link } from '@tanstack/react-router'
import { ExternalLink, Loader2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { ApiKey } from '@/features/keys/types'
import { handleServerError } from '@/lib/handle-server-error'

import type { PlaygroundAgentConfig, PlaygroundAgentSelection } from '../api'
import type { useStudioAgentConfig } from '../hooks/use-studio-agent-config'

const DEFAULT_PROMPT_MODEL = 'gpt-6.1-sol'
const DEFAULT_IMAGE_MODEL = 'gpt-image-2'

type AgentSlot = keyof PlaygroundAgentConfig

type StudioAgentSettingsProps = {
  state: ReturnType<typeof useStudioAgentConfig>
  onSaved?: () => void
  promptOnly?: boolean
}

export function StudioAgentSettings(props: StudioAgentSettingsProps) {
  const { t } = useTranslation()
  const state = props.state
  const [draft, setDraft] = useState<PlaygroundAgentConfig>({
    prompt: null,
    image: null,
  })

  useEffect(() => {
    if (!state.config) return
    setDraft(state.config)
  }, [state.config])

  const modelOptions = useMemo(() => {
    return [
      ...new Set([...state.models, DEFAULT_PROMPT_MODEL, DEFAULT_IMAGE_MODEL]),
    ].sort()
  }, [state.models])
  const hasKeys = state.keys.length > 0

  const setSlot = (
    slot: AgentSlot,
    values: Partial<PlaygroundAgentSelection>
  ) => {
    const current = draft[slot] ?? { token_id: 0, model: '' }
    setDraft({
      ...draft,
      [slot]: { ...current, ...values },
    })
  }

  const save = async () => {
    if (
      !draft.prompt?.token_id ||
      !draft.prompt.model ||
      (!props.promptOnly && (!draft.image?.token_id || !draft.image.model))
    ) {
      return
    }
    try {
      const saved = await state.save(
        props.promptOnly ? { prompt: draft.prompt, image: null } : draft
      )
      setDraft(saved)
      props.onSaved?.()
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <div className='studio-agent-settings'>
      {state.isLoading && (
        <p className='studio-agent-settings-description' role='status'>
          {t('Loading agent configuration...')}
        </p>
      )}
      {!state.isLoading && !hasKeys && (
        <div className='studio-agent-settings-empty'>
          <span>{t('Create an API key first')}</span>
          <Button size='sm' variant='outline' render={<Link to='/keys' />}>
            {t('Open API keys')} <ExternalLink size={13} aria-hidden='true' />
          </Button>
        </div>
      )}
      {!state.isLoading && hasKeys && (
        <div className='studio-agent-settings-grid'>
          <AgentSlotFields
            label={t('Prompt refinement')}
            slot='prompt'
            draft={draft}
            keys={state.keys}
            models={modelOptions}
            onChange={setSlot}
          />
          {!props.promptOnly && (
            <AgentSlotFields
              label={t('Image generation')}
              slot='image'
              draft={draft}
              keys={state.keys}
              models={modelOptions}
              onChange={setSlot}
            />
          )}
          <Button
            type='button'
            className='studio-agent-settings-save'
            disabled={
              !draft.prompt?.token_id ||
              !draft.prompt.model ||
              (!props.promptOnly &&
                (!draft.image?.token_id || !draft.image.model)) ||
              state.isSaving
            }
            onClick={() => void save()}
          >
            {state.isSaving && (
              <Loader2
                size={14}
                className='animate-spin motion-reduce:animate-none'
              />
            )}
            {t('Save configuration')}
          </Button>
        </div>
      )}
    </div>
  )
}

type AgentSlotFieldsProps = {
  label: string
  slot: AgentSlot
  draft: PlaygroundAgentConfig
  keys: ApiKey[]
  models: string[]
  onChange: (slot: AgentSlot, values: Partial<PlaygroundAgentSelection>) => void
}

function AgentSlotFields(props: AgentSlotFieldsProps) {
  const { t } = useTranslation()
  const selected = props.draft[props.slot]
  return (
    <fieldset className='studio-agent-slot'>
      <legend>{props.label}</legend>
      <label>
        <span>{t('API Key')}</span>
        <NativeSelect
          aria-label={`${props.label} ${t('API Key')}`}
          value={selected?.token_id ? String(selected.token_id) : ''}
          onChange={(event) =>
            props.onChange(props.slot, { token_id: Number(event.target.value) })
          }
        >
          <NativeSelectOption value=''>
            {t('Select an API key')}
          </NativeSelectOption>
          {props.keys.map((key) => (
            <NativeSelectOption key={key.id} value={String(key.id)}>
              {key.name || `${t('API Key')} #${key.id}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
      <label>
        <span>{t('Model')}</span>
        <NativeSelect
          aria-label={`${props.label} ${t('Model')}`}
          value={selected?.model ?? ''}
          onChange={(event) =>
            props.onChange(props.slot, { model: event.target.value })
          }
        >
          <NativeSelectOption value=''>
            {t('Select a model')}
          </NativeSelectOption>
          {props.models.map((model) => (
            <NativeSelectOption key={model} value={model}>
              {model}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </label>
    </fieldset>
  )
}
