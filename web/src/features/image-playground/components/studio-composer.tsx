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
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Loader2,
  Plus,
  Settings2,
  Sparkles,
  Square,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { useStudioAgentConfig } from '../hooks/use-studio-agent-config'
import { useImagePlaygroundStore } from '../store'
import {
  getImageModelOptions,
  imageParametersSchema,
  type ImageParameters,
} from '../types'
import { StudioAgentSettings } from './studio-agent-settings'
import { StudioCreationActions } from './studio-creation-actions'
import { StudioParameters, StudioQuickParameters } from './studio-parameters'
import { StudioReferences } from './studio-references'
import { StudioStyleSelector } from './studio-style-selector'

type StudioComposerProps = {
  refining: boolean
  onRefine: (prompt: string) => Promise<string>
  onGenerate: (parameters: ImageParameters) => void
}

export function StudioComposer(props: StudioComposerProps) {
  const { t } = useTranslation()
  const parameters = useImagePlaygroundStore((state) => state.parameters)
  const job = useImagePlaygroundStore((state) => state.job)
  const setParameters = useImagePlaygroundStore((state) => state.setParameters)
  const agentConfig = useStudioAgentConfig()
  const [panelOpen, setPanelOpen] = useState(false)
  const isComposingRef = useRef(false)
  useEffect(() => {
    if (
      agentConfig.config &&
      (!agentConfig.config.prompt || !agentConfig.config.image)
    ) {
      setPanelOpen(true)
    }
  }, [agentConfig.config])

  const form = useForm<ImageParameters>({
    resolver: zodResolver(imageParametersSchema),
    values: parameters,
  })

  const modelOptions = getImageModelOptions(parameters.model)
  const configuredModel = agentConfig.config?.image?.model
  useEffect(() => {
    if (configuredModel) setParameters({ model: configuredModel })
  }, [configuredModel, setParameters])
  const busy = Boolean(job)
  const canGenerate = Boolean(
    parameters.prompt.trim() &&
    !busy &&
    !props.refining &&
    !agentConfig.isLoading &&
    agentConfig.config?.prompt &&
    agentConfig.config.image
  )
  const canRefine = Boolean(
    parameters.prompt.trim() &&
    !busy &&
    !props.refining &&
    !agentConfig.isLoading &&
    agentConfig.config?.prompt
  )

  return (
    <div className='studio-dock'>
      <StudioCreationActions />
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => {
            if (canGenerate) props.onGenerate(values)
          })}
          className='studio-dock-form'
        >
          <StudioStyleSelector />
          {/* Prompt input */}
          <FormField
            control={form.control}
            name='prompt'
            render={({ field }) => (
              <FormItem className='studio-dock-prompt-item'>
                <FormControl id='studio-prompt'>
                  <Textarea
                    {...field}
                    id='studio-prompt'
                    aria-label={t('Image prompt')}
                    disabled={busy || props.refining}
                    maxLength={32000}
                    rows={2}
                    onChange={(event) => {
                      field.onChange(event)
                      setParameters({ prompt: event.target.value })
                    }}
                    onCompositionStart={() => {
                      isComposingRef.current = true
                    }}
                    onCompositionEnd={() => {
                      isComposingRef.current = false
                    }}
                    placeholder={t(
                      'A subject, a setting, a mood… What do you want to see?'
                    )}
                    className='studio-dock-prompt'
                    onPaste={(event) => {
                      const files = [...event.clipboardData.files].filter(
                        (file) => file.type.startsWith('image/')
                      )
                      if (files.length && modelOptions.supportsReferences) {
                        event.preventDefault()
                        try {
                          useImagePlaygroundStore
                            .getState()
                            .addReferences(files)
                        } catch (error) {
                          handleServerError(error)
                        }
                      }
                    }}
                    onKeyDown={(event) => {
                      if (
                        isComposingRef.current ||
                        event.nativeEvent.isComposing ||
                        event.nativeEvent.keyCode === 229
                      ) {
                        return
                      }
                      if (
                        event.key === 'Enter' &&
                        (event.metaKey || event.ctrlKey)
                      ) {
                        event.preventDefault()
                        if (canGenerate) {
                          void form.handleSubmit(props.onGenerate)()
                        }
                      }
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <StudioReferences
            supportsReferences={modelOptions.supportsReferences}
            onAddFiles={(files) => {
              try {
                useImagePlaygroundStore.getState().addReferences(files)
              } catch (error) {
                handleServerError(error)
              }
            }}
          />

          {/* Bottom toolbar: params left, actions right */}
          <div className='studio-dock-toolbar'>
            <StudioQuickParameters />
            {/* Right actions */}
            <div className='studio-dock-actions'>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='studio-dock-refine'
                aria-label={
                  props.refining ? t('Refining...') : t('Refine prompt')
                }
                disabled={!canRefine}
                aria-busy={props.refining}
                onClick={async () => {
                  try {
                    const refined = await props.onRefine(parameters.prompt)
                    setParameters({ prompt: refined })
                    form.setValue('prompt', refined)
                  } catch (error) {
                    if ((error as { name?: string }).name !== 'AbortError') {
                      handleServerError(error)
                    }
                  }
                }}
              >
                {props.refining ? (
                  <Loader2
                    size={14}
                    className='animate-spin motion-reduce:animate-none'
                  />
                ) : (
                  <WandSparkles size={14} aria-hidden='true' />
                )}
                {props.refining ? t('Refining...') : t('Refine')}
              </Button>

              <Popover open={panelOpen} onOpenChange={setPanelOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='studio-dock-icon-btn'
                      aria-label={t('Agent settings')}
                      disabled={busy || props.refining}
                    />
                  }
                >
                  <Settings2 size={16} aria-hidden='true' />
                </PopoverTrigger>
                <PopoverContent
                  side='top'
                  align='end'
                  sideOffset={16}
                  className='studio-settings-popover'
                  aria-label={t('Agent settings')}
                >
                  <PopoverTitle>{t('Agent settings')}</PopoverTitle>
                  <StudioAgentSettings
                    state={agentConfig}
                    onSaved={() => setPanelOpen(false)}
                  />
                  <StudioParameters secondaryOnly />
                </PopoverContent>
              </Popover>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='studio-dock-icon-btn'
                aria-label={t('Create')}
                disabled={busy || props.refining}
                onClick={() => {
                  useImagePlaygroundStore.getState().clearDraft()
                  document
                    .querySelector<HTMLTextAreaElement>('#studio-prompt')
                    ?.focus()
                }}
              >
                <Plus size={16} aria-hidden='true' />
              </Button>
              {job && (
                <Button
                  type='button'
                  variant='ghost'
                  className='studio-dock-refine'
                  onClick={() => job.controller.abort()}
                >
                  <Square size={14} aria-hidden='true' />
                  {t('Stop waiting')}
                </Button>
              )}
              <Button
                type='submit'
                disabled={!canGenerate}
                aria-label={t('Generate image')}
                className='studio-dock-generate'
              >
                {busy ? (
                  <Loader2
                    size={16}
                    className='animate-spin motion-reduce:animate-none'
                  />
                ) : (
                  <Sparkles size={16} aria-hidden='true' />
                )}
                {busy ? t('Creating...') : t('Generate')}
              </Button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  )
}
