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
  ArrowUpRight,
  Loader2,
  Plus,
  Settings2,
  WandSparkles,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { useStudioAgentConfig } from '../hooks/use-studio-agent-config'
import { useStudioGroups } from '../hooks/use-studio-groups'
import { stylePresets } from '../lib/style-presets'
import { useImagePlaygroundStore } from '../store'
import {
  getImageModelOptions,
  imageParametersSchema,
  type ImageParameters,
} from '../types'
import { StudioAgentSettings } from './studio-agent-settings'
import { StudioCostEstimate } from './studio-cost-estimate'
import { StudioParameters } from './studio-parameters'
import { StudioReferences } from './studio-references'

export function StudioComposer(props: {
  refining: boolean
  onRefine: (prompt: string) => Promise<string>
  onGenerate: (parameters: ImageParameters) => void
}) {
  const { t } = useTranslation()
  const parameters = useImagePlaygroundStore((state) => state.parameters)
  const activeCount = useImagePlaygroundStore(
    (state) => state.jobs.filter((job) => !job.error).length
  )
  const setParameters = useImagePlaygroundStore((state) => state.setParameters)
  const groups = useStudioGroups()
  const [promptSettingsOpen, setPromptSettingsOpen] = useState(false)
  const agentConfig = useStudioAgentConfig(promptSettingsOpen)
  const selectedStyleId = useImagePlaygroundStore(
    (state) => state.selectedStyleId
  )
  const isComposingRef = useRef(false)
  const group = groups.data?.find((item) => item.id === parameters.group)
  const form = useForm<ImageParameters>({
    resolver: zodResolver(imageParametersSchema),
    values: parameters,
  })
  useEffect(() => {
    if (!groups.data?.length) return
    const selected = groups.data.find((item) => item.id === parameters.group)
    if (!selected) {
      const first = groups.data.find((item) => item.available) ?? groups.data[0]
      setParameters({
        group: first.id,
        model: first.models[0] ?? '',
        size: 'auto',
      })
    } else if (!selected.models.includes(parameters.model)) {
      setParameters({ model: selected.models[0] ?? '', size: 'auto' })
    }
  }, [groups.data, parameters.group, parameters.model, setParameters])
  const modelOptions = getImageModelOptions(parameters.model)
  const canGenerate = Boolean(
    parameters.prompt.trim() &&
    group?.available &&
    group.models.includes(parameters.model) &&
    activeCount < 4 &&
    !props.refining
  )
  const canRefine = Boolean(
    parameters.prompt.trim() && agentConfig.config?.prompt && !props.refining
  )
  return (
    <aside className='studio-dock' aria-label={t('Creation settings')}>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => {
            if (canGenerate) props.onGenerate(values)
          })}
          className='studio-dock-form'
        >
          <div className='studio-panel-scroll'>
            <div className='studio-section-heading'>
              <div>
                <h2>{t('Create an image')}</h2>
                <p>{t('Turn your idea into an image')}</p>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label={t('New draft')}
                onClick={() => {
                  useImagePlaygroundStore.getState().clearDraft()
                  document
                    .querySelector<HTMLTextAreaElement>('#studio-prompt')
                    ?.focus()
                }}
              >
                <Plus size={17} />
              </Button>
            </div>
            <div className='studio-field studio-group-field'>
              <Label htmlFor='studio-group'>{t('Generation group')}</Label>
              <NativeSelect
                id='studio-group'
                className='studio-native-select'
                value={parameters.group ?? ''}
                disabled={groups.isLoading}
                onChange={(event) => {
                  const next = groups.data?.find(
                    (item) => item.id === event.target.value
                  )
                  if (next) {
                    setParameters({
                      group: next.id,
                      model: next.models.includes(parameters.model)
                        ? parameters.model
                        : (next.models[0] ?? ''),
                      size: 'auto',
                    })
                  }
                }}
              >
                {!group && (
                  <NativeSelectOption value=''>
                    {groups.isLoading ? t('Loading...') : t('Select a group')}
                  </NativeSelectOption>
                )}
                {groups.data?.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name} · {item.ratio}×
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {group && (
                <p className='studio-field-hint'>{group.description}</p>
              )}
              {group && !group.available && (
                <p className='studio-field-error' role='alert'>
                  {t(
                    'This group is unavailable. Check its API key or choose another group.'
                  )}
                </p>
              )}
              {groups.isSuccess && groups.data.length === 0 && (
                <p className='studio-field-error' role='alert'>
                  {t('No image groups are available for this account.')}
                </p>
              )}
              {groups.isError && (
                <div className='studio-field-error' role='alert'>
                  {t('Could not load generation groups.')}{' '}
                  <Button
                    type='button'
                    variant='link'
                    onClick={() => void groups.refetch()}
                  >
                    {t('Retry')}
                  </Button>
                </div>
              )}
            </div>
            <div className='studio-field'>
              <Label htmlFor='studio-model'>{t('Model')}</Label>
              <NativeSelect
                id='studio-model'
                className='studio-native-select'
                value={parameters.model}
                disabled={!group?.models.length}
                onChange={(event) =>
                  setParameters({ model: event.target.value })
                }
              >
                {group?.models.map((model) => (
                  <NativeSelectOption key={model} value={model}>
                    {model}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <div className='studio-prompt-heading'>
              <Label htmlFor='studio-prompt'>{t('Image prompt')}</Label>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                disabled={!canRefine}
                aria-busy={props.refining}
                aria-label={
                  props.refining ? t('Refining...') : t('Refine prompt')
                }
                title={
                  !agentConfig.config?.prompt
                    ? t('Prompt refinement is not configured')
                    : undefined
                }
                onClick={async () => {
                  const original = parameters.prompt
                  try {
                    const refined = await props.onRefine(original)
                    if (
                      useImagePlaygroundStore.getState().parameters.prompt ===
                      original
                    ) {
                      setParameters({ prompt: refined })
                    }
                  } catch (error) {
                    if ((error as { name?: string }).name !== 'AbortError') {
                      handleServerError(error)
                    }
                  }
                }}
              >
                {props.refining ? (
                  <Loader2 size={13} className='animate-spin' />
                ) : (
                  <WandSparkles size={13} />
                )}
                {props.refining ? t('Refining...') : t('Refine')}
              </Button>
              <Dialog
                open={promptSettingsOpen}
                onOpenChange={setPromptSettingsOpen}
                title={t('Prompt refinement')}
                trigger={
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    aria-label={t('Prompt refinement settings')}
                  >
                    <Settings2 size={13} />
                  </Button>
                }
              >
                <StudioAgentSettings
                  state={agentConfig}
                  promptOnly
                  onSaved={() => setPromptSettingsOpen(false)}
                />
              </Dialog>
            </div>
            <FormField
              control={form.control}
              name='prompt'
              render={({ field }) => (
                <FormItem>
                  <FormControl id='studio-prompt'>
                    <Textarea
                      {...field}
                      id='studio-prompt'
                      aria-label={t('Image prompt')}
                      maxLength={32000}
                      rows={5}
                      className='studio-dock-prompt'
                      placeholder={t(
                        'Describe your image: subject, setting, light and details…'
                      )}
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
            <div className='studio-reference-heading'>
              <Label htmlFor='studio-reference'>{t('Reference images')}</Label>
              <span>{t('Optional')}</span>
            </div>
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
            <div className='studio-section-divider' />
            <StudioParameters group={group} />
            <div className='studio-field'>
              <Label htmlFor='studio-style'>{t('Style')}</Label>
              <NativeSelect
                id='studio-style'
                className='studio-native-select'
                value={selectedStyleId ?? ''}
                onChange={(event) =>
                  useImagePlaygroundStore.setState({
                    selectedStyleId: event.target.value || null,
                  })
                }
              >
                <NativeSelectOption value=''>
                  {t('No style')}
                </NativeSelectOption>
                {stylePresets.map((preset) => (
                  <NativeSelectOption key={preset.id} value={preset.id}>
                    {t(preset.label)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          <div className='studio-submit-area'>
            <Button
              type='submit'
              className='studio-dock-generate'
              disabled={!canGenerate}
              aria-label={t('Generate image')}
              title={t('⌘ / Ctrl + Enter to generate')}
            >
              <ArrowUpRight size={18} />
              {t('Generate')}
              <span>
                {parameters.count} {t('image(s)')}
              </span>
            </Button>
            <StudioCostEstimate group={group} />
            {activeCount >= 4 && (
              <p role='status'>
                {t('Four tasks are running. Submit again when one finishes.')}
              </p>
            )}
          </div>
        </form>
      </Form>
    </aside>
  )
}
