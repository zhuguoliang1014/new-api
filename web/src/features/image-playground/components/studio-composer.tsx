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
import { Link } from '@tanstack/react-router'
import { ArrowUpRight, Loader2, Sparkles } from 'lucide-react'
import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import type { ApiKey } from '@/features/keys/types'
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
  keys: ApiKey[]
  keyId: number | null
  keysLoading: boolean
  models: string[]
  modelsLoading: boolean
  modelsError: boolean
  retryModels: () => void
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
  const busy = Boolean(job)
  const canGenerate = Boolean(
    props.keyId && parameters.model.trim() && parameters.prompt.trim() && !busy
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
      </div>
      <div className='studio-field'>
        <Label htmlFor='studio-key'>{t('API Key')}</Label>
        <NativeSelect
          id='studio-key'
          value={props.keyId ?? ''}
          className='studio-native-select'
          disabled={busy || props.keysLoading || !props.keys.length}
          onChange={(event) =>
            useImagePlaygroundStore
              .getState()
              .setKey(Number(event.target.value))
          }
        >
          {!props.keys.length && (
            <NativeSelectOption value=''>
              {props.keysLoading ? t('Loading...') : t('No available API key')}
            </NativeSelectOption>
          )}
          {props.keys.map((key) => (
            <NativeSelectOption key={key.id} value={key.id}>
              {key.name || `#${key.id}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {!props.keysLoading && !props.keys.length && (
          <Link to='/keys' className='studio-inline-link'>
            {t('Create API Key')}
            <ArrowUpRight size={14} aria-hidden='true' />
          </Link>
        )}
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(props.onGenerate)}
          className='studio-form'
        >
          <FormField
            control={form.control}
            name='model'
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor='studio-model'>{t('Image model')}</FormLabel>
                <FormControl id='studio-model'>
                  <Combobox
                    id='studio-model'
                    options={props.models.map((model) => ({
                      value: model,
                      label: model,
                    }))}
                    value={field.value}
                    onValueChange={(model) =>
                      setParameters({ model: model ?? '' })
                    }
                    allowCustomValue
                    disabled={busy || !props.keyId}
                    placeholder={
                      props.modelsLoading
                        ? t('Loading image models...')
                        : t('Select or enter an image model')
                    }
                    className='studio-model-input'
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {props.modelsError && (
            <div className='studio-inline-feedback'>
              <span>
                {t('Model discovery failed. You can enter a model name.')}
              </span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={props.retryModels}
              >
                {t('Retry')}
              </Button>
            </div>
          )}
          <FormField
            control={form.control}
            name='prompt'
            render={({ field }) => (
              <FormItem>
                <div className='studio-label-row'>
                  <FormLabel htmlFor='studio-prompt'>
                    {t('Image prompt')}
                  </FormLabel>
                  <span>{t('Be specific, be creative')}</span>
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
            <p>{t('Uses your selected key and its billing group.')}</p>
            <span className='studio-shortcut'>
              {t('Ctrl / ⌘ + Enter to generate')}
            </span>
          </div>
        </form>
      </Form>
    </aside>
  )
}
