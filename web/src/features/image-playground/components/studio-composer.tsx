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
import { ChevronRight, Loader2, Sparkles, WandSparkles, X } from 'lucide-react'
import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { useImagePlaygroundStore } from '../store'
import {
  getImageModelOptions,
  imageParametersSchema,
  type ImageParameters,
} from '../types'
import { StudioParameters } from './studio-parameters'
import { StudioReferences } from './studio-references'

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
  const isComposingRef = useRef(false)
  const form = useForm<ImageParameters>({
    resolver: zodResolver(imageParametersSchema),
    values: parameters,
  })
  const modelOptions = getImageModelOptions(parameters.model)
  const promptIdeas = [
    {
      label: t('Product photography'),
      prompt: t(
        'A premium amber perfume bottle on a travertine pedestal, warm sunlight, soft shadows, a minimal editorial product photograph.'
      ),
    },
    {
      label: t('Travel poster'),
      prompt: t(
        'A vintage travel poster of a quiet mountain lake, layered forest silhouettes, a coral sun, textured paper, a limited teal and cream palette, no text.'
      ),
    },
    {
      label: t('Dream architecture'),
      prompt: t(
        'A sculptural seaside house with curved white walls and a terracotta staircase, Mediterranean light, calm blue water, architectural photography.'
      ),
    },
  ]
  const busy = Boolean(job)
  const canGenerate = Boolean(
    parameters.prompt.trim() && !busy && !props.refining
  )
  const canRefine = Boolean(
    parameters.prompt.trim() && !busy && !props.refining
  )
  const addFiles = (files: File[]) => {
    try {
      useImagePlaygroundStore.getState().addReferences(files)
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <aside className='studio-composer' aria-label={t('Creation settings')}>
      <div className='studio-composer-title'>
        <span className='studio-step'>01</span>
        <div>
          <h2>{t('Your idea, in focus')}</h2>
          <p>{t('Describe it. Make it yours.')}</p>
        </div>
        <span className='studio-composer-chevron' aria-hidden='true'>
          <ChevronRight size={16} />
        </span>
      </div>
      <div className='studio-agent-note' role='status'>
        <Sparkles size={14} aria-hidden='true' />
        <span>
          {t('The studio agent chooses the image model automatically.')}
        </span>
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(props.onGenerate)}
          className='studio-form'
        >
          <FormField
            control={form.control}
            name='prompt'
            render={({ field }) => (
              <FormItem>
                <div className='studio-label-row'>
                  <FormLabel htmlFor='studio-prompt'>
                    {t('Image prompt')}
                  </FormLabel>
                  <div className='studio-prompt-label-actions'>
                    <span>{t('Be specific, be creative')}</span>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='studio-refine-prompt'
                      disabled={!canRefine}
                      aria-busy={props.refining}
                      onClick={async () => {
                        try {
                          const refined = await props.onRefine(
                            parameters.prompt
                          )
                          setParameters({ prompt: refined })
                          form.setValue('prompt', refined)
                        } catch (error) {
                          if (
                            (error as { name?: string }).name !== 'AbortError'
                          ) {
                            handleServerError(error)
                          }
                        }
                      }}
                    >
                      {props.refining ? (
                        <Loader2 className='animate-spin motion-reduce:animate-none' />
                      ) : (
                        <WandSparkles size={14} aria-hidden='true' />
                      )}
                      {props.refining ? t('Refining...') : t('Refine prompt')}
                    </Button>
                    {parameters.prompt && (
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon-xs'
                        className='studio-clear-prompt'
                        aria-label={t('Clear')}
                        onClick={() => {
                          useImagePlaygroundStore.getState().setParameters({
                            prompt: '',
                          })
                          form.setValue('prompt', '')
                        }}
                      >
                        <X size={13} aria-hidden='true' />
                      </Button>
                    )}
                  </div>
                </div>
                <FormControl id='studio-prompt'>
                  <Textarea
                    {...field}
                    id='studio-prompt'
                    disabled={busy}
                    maxLength={32000}
                    onChange={(event) => {
                      // Update the controlled field synchronously so React does
                      // not restore its previous value and cancel the IME.
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
                    className='studio-prompt'
                    onPaste={(event) => {
                      const files = [...event.clipboardData.files].filter(
                        (file) => file.type.startsWith('image/')
                      )
                      if (files.length && modelOptions.supportsReferences) {
                        event.preventDefault()
                        addFiles(files)
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
                <div className='studio-prompt-kit' aria-label={t('Prompt')}>
                  <div className='studio-prompt-kit-heading'>
                    <span>
                      <WandSparkles size={13} aria-hidden='true' />
                      {t('A little inspiration')}
                    </span>
                    <span>
                      {t('Illustrated prompt ideas · Select one to try')}
                    </span>
                  </div>
                  <div className='studio-prompt-ideas'>
                    {promptIdeas.map((idea, index) => (
                      <Button
                        key={idea.label}
                        type='button'
                        variant='outline'
                        size='sm'
                        className='studio-prompt-idea'
                        aria-label={`${t('A little inspiration')} ${index + 1}`}
                        title={idea.label}
                        onClick={() => {
                          const nextPrompt = parameters.prompt.trim()
                            ? `${parameters.prompt.trim()}\n\n${idea.prompt}`
                            : idea.prompt
                          setParameters({ prompt: nextPrompt })
                          form.setValue('prompt', nextPrompt)
                          document
                            .querySelector<HTMLTextAreaElement>(
                              '#studio-prompt'
                            )
                            ?.focus()
                        }}
                      >
                        {idea.label}
                      </Button>
                    ))}
                  </div>
                </div>
              </FormItem>
            )}
          />
          <StudioReferences
            supportsReferences={modelOptions.supportsReferences}
            onAddFiles={addFiles}
          />
          <StudioParameters />
          <div className='studio-submit-area'>
            <Button
              type='submit'
              disabled={!canGenerate}
              className='studio-generate'
            >
              {busy ? (
                <Loader2 className='animate-spin motion-reduce:animate-none' />
              ) : (
                <Sparkles size={18} aria-hidden='true' />
              )}
              {busy ? t('Creating your image...') : t('Generate image')}
            </Button>
            <p>{t('The studio agent handles the model and billing setup.')}</p>
            <span className='studio-shortcut'>
              {t('Ctrl / ⌘ + Enter to generate')}
            </span>
          </div>
        </form>
      </Form>
    </aside>
  )
}
