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
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import type { StudioGroup } from '../api'
import {
  getStudioSize,
  getStudioSizeSelection,
  imageAspectPresets,
  studioResolutions,
} from '../lib/sizes'
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
export function StudioParameters(props: { group?: StudioGroup }) {
  const { t } = useTranslation()
  const parameters = useImagePlaygroundStore((state) => state.parameters)
  const setParameters = useImagePlaygroundStore((state) => state.setParameters)
  const options = getImageModelOptions(parameters.model)
  const mode = props.group?.size_mode ?? 'native'
  const selected = getStudioSizeSelection(parameters.size, mode)
  const labels: Record<string, string> = {
    auto: t('Auto'),
    low: t('Low'),
    medium: t('Medium'),
    high: t('High'),
    standard: t('Standard'),
    hd: t('HD'),
    opaque: t('Opaque'),
    transparent: t('Transparent'),
  }
  return (
    <section
      className='studio-settings-section'
      aria-label={t('Image settings')}
    >
      <h3>{t('Image settings')}</h3>
      <div className='studio-field'>
        <Label>{t('Aspect ratio')}</Label>
        <div
          className='studio-aspects'
          role='group'
          aria-label={t('Aspect ratio')}
        >
          <Button
            type='button'
            variant='ghost'
            aria-pressed={parameters.size === 'auto'}
            onClick={() => setParameters({ size: 'auto' })}
          >
            {t('Auto')}
          </Button>
          {imageAspectPresets.map((preset) => (
            <Button
              key={preset.ratio}
              type='button'
              variant='ghost'
              aria-pressed={
                parameters.size !== 'auto' && selected.ratio === preset.ratio
              }
              onClick={() =>
                setParameters({
                  size: getStudioSize(preset.ratio, selected.resolution, mode),
                })
              }
            >
              <span
                className='studio-ratio-icon'
                style={{ aspectRatio: preset.ratio.replace(':', '/') }}
                aria-hidden='true'
              />
              {preset.ratio}
            </Button>
          ))}
        </div>
      </div>
      <div className='studio-field'>
        <div className='studio-field-label'>
          <Label>{t('Resolution')}</Label>
          <span>
            {parameters.size === 'auto'
              ? t('Auto')
              : parameters.size.replace('x', ' × ')}
          </span>
        </div>
        <div
          className='studio-resolutions'
          role='group'
          aria-label={t('Resolution')}
        >
          {studioResolutions
            .filter(
              (value) =>
                Number.parseInt(value) <= (props.group?.max_resolution ?? 4)
            )
            .map((value) => (
              <Button
                type='button'
                variant='ghost'
                key={value}
                aria-pressed={
                  parameters.size !== 'auto' && selected.resolution === value
                }
                onClick={() =>
                  setParameters({
                    size: getStudioSize(selected.ratio, value, mode),
                  })
                }
              >
                {value}
              </Button>
            ))}
        </div>
      </div>
      <div className='studio-parameter-grid'>
        <ParameterSelect
          id='studio-quality'
          label={t('Quality')}
          value={parameters.quality}
          options={options.qualities.map((value) => ({
            value,
            label: labels[value],
          }))}
          onChange={(quality) =>
            setParameters({ quality: quality as ImageParameters['quality'] })
          }
        />
        <ParameterSelect
          id='studio-count'
          label={t('Image count')}
          value={String(parameters.count)}
          options={Array.from({ length: options.maxCount }, (_, index) => ({
            value: String(index + 1),
            label: t('{{count}} image(s)', { count: index + 1 }),
          }))}
          onChange={(count) => setParameters({ count: Number(count) })}
        />
        <ParameterSelect
          id='studio-format'
          label={t('File format')}
          value={parameters.format}
          options={['png', 'jpeg', 'webp'].map((value) => ({
            value,
            label: value.toUpperCase(),
          }))}
          onChange={(format) =>
            setParameters({ format: format as ImageParameters['format'] })
          }
        />
        <ParameterSelect
          id='studio-background'
          label={t('Image background')}
          value={parameters.background}
          disabled={parameters.format === 'jpeg'}
          options={['auto', 'opaque', 'transparent'].map((value) => ({
            value,
            label: labels[value],
          }))}
          onChange={(background) =>
            setParameters({
              background: background as ImageParameters['background'],
            })
          }
        />
      </div>
      {parameters.format === 'jpeg' && (
        <p className='studio-field-hint'>
          {t('JPEG does not support transparency. Use PNG or WebP.')}
        </p>
      )}
    </section>
  )
}
