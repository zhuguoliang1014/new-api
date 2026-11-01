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
import { ModelSelector } from '@/components/model-group-selector'
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

import { getStudioModelProfile } from '../api'
import { useStudioAgentConfig } from '../hooks/use-studio-agent-config'
import { useStudioGroups } from '../hooks/use-studio-groups'
import { getStudioDefaultSize, getStudioSizeSelection } from '../lib/sizes'
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
import { StudioStyleSelector } from './studio-style-selector'

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
  const isComposingRef = useRef(false)
  const group = groups.data?.find((item) => item.id === parameters.group)
  const modelProfile = getStudioModelProfile(group, parameters.model)
  let groupDescription = ''
  if (modelProfile?.size_mode === 'ratio') {
    groupDescription = t(
      'Charged per request. Usually returns four images; a grid cover is optional.'
    )
  } else if (parameters.model.startsWith('gemini-')) {
    groupDescription = t(
      'Create or edit an image with Banana. Use reference images to guide the result.'
    )
  } else if (modelProfile?.size_mode === 'native') {
    groupDescription = t('For detailed creative work')
  } else if (modelProfile && modelProfile.max_resolution > 4) {
    groupDescription = t('For high-resolution posters and covers')
  } else if (group) {
    groupDescription = t('For everyday images and batch creation')
  }
  const form = useForm<ImageParameters>({
    resolver: zodResolver(imageParametersSchema),
    values: parameters,
  })
  useEffect(() => {
    if (!groups.data?.length) return
    const selected = groups.data.find((item) => item.id === parameters.group)
    if (!selected) {
      const first = groups.data.find((item) => item.available) ?? groups.data[0]
      const legacySuffix: Record<string, string> = {
        '【生图】超分基础版1-4k': 'basic',
        '【生图】超分高质量1-10k': 'hq',
        '【生图】官逆原生1-4k': 'native',
      }
      const suffix = legacySuffix[parameters.group ?? '']
      const legacyModel = suffix ? `${parameters.model}-${suffix}` : ''
      const model = first.models.includes(legacyModel)
        ? legacyModel
        : (first.models[0] ?? '')
      setParameters({
        group: first.id,
        model,
        size:
          model === legacyModel
            ? parameters.size
            : getStudioDefaultSize(
                getStudioModelProfile(first, model) ?? first
              ),
      })
    } else if (!selected.models.includes(parameters.model)) {
      setParameters({
        model: selected.models[0] ?? '',
        size: getStudioDefaultSize(
          getStudioModelProfile(selected, selected.models[0] ?? '') ?? selected
        ),
      })
    }
  }, [
    groups.data,
    parameters.group,
    parameters.model,
    parameters.size,
    setParameters,
  ])
  const modelOptions = getImageModelOptions(parameters.model)
  const [width, height] = parameters.size.split('x').map(Number)
  const maxEdge =
    modelProfile?.max_edge ??
    (modelProfile?.size_mode === 'native'
      ? 3840
      : (modelProfile?.max_resolution ?? 4) * 1024)
  const maxPixels =
    modelProfile?.max_pixels ??
    (modelProfile?.size_mode === 'native' ? 8294400 : maxEdge * maxEdge)
  const sizeSupported =
    parameters.size === 'auto' ||
    (modelProfile?.size_mode === 'ratio'
      ? modelOptions.sizes.includes(parameters.size)
      : width >= 256 &&
        height >= 256 &&
        width <= maxEdge &&
        height <= maxEdge &&
        width * height <= maxPixels &&
        width % 16 === 0 &&
        height % 16 === 0 &&
        Math.max(width, height) <= Math.min(width, height) * 3)
  const canGenerate = Boolean(
    sizeSupported &&
    imageParametersSchema.safeParse(parameters).success &&
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
            <div className='studio-field'>
              <Label htmlFor='studio-model'>{t('Model')}</Label>
              <ModelSelector
                id='studio-model'
                presentation='field'
                selectedModel={parameters.model}
                disabled={!group?.models.length}
                models={(group?.models ?? []).map((model) => {
                  let label = model
                  let description = model
                  let category = t('Other')
                  if (model.endsWith('-basic')) {
                    label = model.slice(0, -6)
                    description = t('Basic · up to 4K')
                    category = t('GPT Image · Basic')
                  } else if (model.endsWith('-hq')) {
                    label = model.slice(0, -3)
                    description = t('High quality · up to 8K')
                    category = t('GPT Image · High quality')
                  } else if (model.endsWith('-native')) {
                    label = model.slice(0, -7)
                    description = t('Native · up to 4K')
                    category = t('GPT Image · Native')
                  } else if (model.startsWith('gemini-')) {
                    category = t('Banana')
                    if (model.includes('3-pro')) {
                      label = t('Banana Pro')
                    } else if (model.includes('3.1-flash')) {
                      label = t('Banana 2')
                    } else if (model.includes('nano-banana')) {
                      label = `${t('Banana')} · 2.1`
                    } else {
                      label = `${t('Banana')} · Gemini 2.5 Flash`
                    }
                    if (model.endsWith('-preview')) {
                      label += ` · ${t('Preview')}`
                    }
                  } else if (model === 'mj-v8.2') {
                    label = 'Midjourney v8.2'
                    description = t('Usually 4 images per request')
                    category = 'Midjourney'
                  }
                  return {
                    value: model,
                    label,
                    category,
                    description,
                    price: (
                      <StudioCostEstimate
                        group={group}
                        model={model}
                        presentation='unit'
                      />
                    ),
                  }
                })}
                onModelChange={(model) => {
                  setParameters({
                    model,
                    size: getStudioDefaultSize(
                      getStudioModelProfile(group, model) ?? {
                        max_resolution: 4,
                        size_mode: 'native',
                      },
                      getStudioSizeSelection(
                        parameters.size,
                        modelProfile?.size_mode ?? 'native'
                      ).ratio
                    ),
                  })
                }}
              />
            </div>
            <div
              className='studio-field studio-group-field'
              aria-label={t('Selected model information')}
            >
              {groups.data?.length === 1 ? (
                <p className='studio-field-hint'>{parameters.model}</p>
              ) : (
                <>
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
                          size: getStudioDefaultSize(
                            next,
                            getStudioSizeSelection(
                              parameters.size,
                              group?.size_mode ?? 'native'
                            ).ratio
                          ),
                        })
                      }
                    }}
                  >
                    {!group && (
                      <NativeSelectOption value=''>
                        {groups.isLoading
                          ? t('Loading...')
                          : t('Select a group')}
                      </NativeSelectOption>
                    )}
                    {groups.data?.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {t(item.name)} · {item.ratio}×
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </>
              )}
              {group && <p className='studio-field-hint'>{groupDescription}</p>}
              {!sizeSupported && (
                <p className='studio-field-error' role='alert'>
                  {t('the selected image size is not supported by this group')}
                </p>
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
                      maxLength={modelOptions.isMidjourney ? 1023 : 32000}
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
              maxReferences={modelOptions.maxReferences}
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
            <StudioStyleSelector />
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
                {modelOptions.isMidjourney ? (
                  t('One request')
                ) : (
                  <>
                    {parameters.count} {t('image(s)')}
                  </>
                )}
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
