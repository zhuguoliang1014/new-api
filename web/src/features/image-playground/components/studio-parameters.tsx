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
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { useImagePlaygroundStore } from '../store'
import { getImageModelOptions, type ImageParameters } from '../types'

function ParameterSelect(props: {
  id: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className='studio-field'>
      <Label htmlFor={props.id}>{props.label}</Label>
      <NativeSelect
        id={props.id}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className='studio-native-select'
        disabled={props.disabled}
      >
        {props.options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  )
}

export function StudioParameters() {
  const { t } = useTranslation()
  const parameters = useImagePlaygroundStore((state) => state.parameters)
  const busy = useImagePlaygroundStore((state) => Boolean(state.job))
  const setParameters = useImagePlaygroundStore((state) => state.setParameters)
  const modelOptions = getImageModelOptions(parameters.model)
  const labels: Record<string, string> = {
    auto: t('Auto'),
    low: t('Low'),
    medium: t('Medium'),
    high: t('High'),
    standard: t('Standard'),
    hd: t('HD'),
    opaque: t('Opaque'),
    transparent: t('Transparent'),
    png: 'PNG',
    jpeg: 'JPEG',
    webp: 'WebP',
  }
  return (
    <>
      <div className='studio-parameter-grid'>
        <ParameterSelect
          id='studio-size'
          label={t('Image size')}
          value={parameters.size}
          options={modelOptions.sizes.map((value) => ({
            value,
            label: value === 'auto' ? t('Auto') : value.replace('x', ' × '),
          }))}
          disabled={busy}
          onChange={(size) =>
            setParameters({ size: size as ImageParameters['size'] })
          }
        />
        <ParameterSelect
          id='studio-count'
          label={t('Image count')}
          value={String(parameters.count)}
          options={Array.from(
            { length: modelOptions.maxCount },
            (_, index) => ({
              value: String(index + 1),
              label: t('{{count}} image(s)', { count: index + 1 }),
            })
          )}
          disabled={busy}
          onChange={(count) => setParameters({ count: Number(count) })}
        />
        {modelOptions.qualities.length > 1 && (
          <ParameterSelect
            id='studio-quality'
            label={t('Quality')}
            value={parameters.quality}
            options={modelOptions.qualities.map((value) => ({
              value,
              label: labels[value],
            }))}
            disabled={busy}
            onChange={(quality) =>
              setParameters({
                quality: quality as ImageParameters['quality'],
              })
            }
          />
        )}
      </div>
      {modelOptions.isGptImage && (
        <Collapsible className='studio-advanced'>
          <CollapsibleTrigger
            render={
              <Button
                type='button'
                variant='ghost'
                className='studio-advanced-trigger'
              />
            }
          >
            {t('Output settings')}
            <ChevronDown size={14} aria-hidden='true' />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className='studio-parameter-grid'>
              {modelOptions.isGptImage && (
                <ParameterSelect
                  id='studio-format'
                  label={t('File format')}
                  value={parameters.format}
                  options={['png', 'jpeg', 'webp'].map((value) => ({
                    value,
                    label: labels[value],
                  }))}
                  disabled={busy}
                  onChange={(format) =>
                    setParameters({
                      format: format as ImageParameters['format'],
                    })
                  }
                />
              )}
              {modelOptions.isGptImage && (
                <ParameterSelect
                  id='studio-background'
                  label={t('Image background')}
                  value={parameters.background}
                  options={['auto', 'opaque', 'transparent'].map((value) => ({
                    value,
                    label: labels[value],
                  }))}
                  disabled={busy || parameters.format === 'jpeg'}
                  onChange={(background) =>
                    setParameters({
                      background: background as ImageParameters['background'],
                    })
                  }
                />
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </>
  )
}
