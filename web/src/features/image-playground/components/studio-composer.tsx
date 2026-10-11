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
  Bot,
  Loader2,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Square,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
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
  const [settingsOpen, setSettingsOpen] = useState<boolean | null>(null)
  const needsSetup = Boolean(
    agentConfig.config &&
    (!agentConfig.config.prompt || !agentConfig.config.image)
  )
  const isComposingRef = useRef(false)

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
          <div className='studio-dock-input'>
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
          </div>
          <Collapsible>
            {/* Bottom toolbar: params left, actions right */}
            <div className='studio-dock-toolbar'>
              <div className='studio-dock-controls'>
                <StudioQuickParameters />
              </div>
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

                <CollapsibleTrigger
                  render={
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='studio-dock-icon-btn'
                      aria-label={t('Advanced settings')}
                      title={t('Advanced settings')}
                    />
                  }
                >
                  <SlidersHorizontal size={16} aria-hidden='true' />
                </CollapsibleTrigger>
                <Dialog
                  open={settingsOpen ?? needsSetup}
                  onOpenChange={setSettingsOpen}
                  title={t('Agent settings')}
                  description={t(
                    'Choose one API key and model for prompt refinement, and another for image generation.'
                  )}
                  contentClassName='studio-agent-dialog'
                  trigger={
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      className='studio-dock-icon-btn'
                      aria-label={t('Agent settings')}
                      title={t('Agent settings')}
                      disabled={busy || props.refining}
                    >
                      <Bot size={17} aria-hidden='true' />
                    </Button>
                  }
                >
                  <StudioAgentSettings
                    state={agentConfig}
                    onSaved={() => setSettingsOpen(false)}
                  />
                </Dialog>
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
            <CollapsibleContent className='studio-dock-advanced'>
              <StudioParameters />
            </CollapsibleContent>
          </Collapsible>
        </form>
      </Form>
    </div>
  )
}
