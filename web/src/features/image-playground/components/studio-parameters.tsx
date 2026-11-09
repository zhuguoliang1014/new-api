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

import { getStudioModelProfile, type StudioGroup } from '../api'
import {
  getStudioSize,
  getStudioSizeSelection,
  imageAspectPresets,
  studioResolutions,
  type StudioResolution,
} from '../lib/sizes'
import { useImagePlaygroundStore } from '../store'
import { getImageModelOptions, type ImageParameters } from '../types'
import { StudioMidjourneyParameters } from './studio-midjourney-parameters'

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
export function StudioParameters(props: {
  group?: StudioGroup
  presentation?: 'default' | 'compact'
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const parameters = useImagePlaygroundStore((state) => state.parameters)
  const setParameters = useImagePlaygroundStore((state) => state.setParameters)
  const options = getImageModelOptions(parameters.model)
  const profile = getStudioModelProfile(props.group, parameters.model)
  const mode = profile?.size_mode ?? 'native'
  const compact = props.presentation === 'compact'
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
      className={`studio-settings-section${compact ? ' studio-settings-inline' : ''}`}
      aria-label={t('Image settings')}
    >
      <div className='studio-settings-title'>
        <h3>{t('Image settings')}</h3>
        {compact && (
          <span>
            {parameters.size === 'auto'
              ? t('Auto')
              : parameters.size.replace('x', ' × ')}
          </span>
        )}
      </div>
      <fieldset disabled={props.disabled} className='studio-parameter-fields'>
        {compact ? (
          <div className='studio-parameter-grid studio-dimension-grid'>
            <ParameterSelect
              id='studio-aspect'
              label={t('Aspect ratio')}
              value={parameters.size === 'auto' ? 'auto' : selected.ratio}
              options={[
                { value: 'auto', label: t('Auto') },
                ...(options.isMidjourney
                  ? options.sizes.filter((ratio) => ratio !== 'auto')
                  : imageAspectPresets.map((preset) => preset.ratio)
                ).map((ratio) => ({ value: ratio, label: ratio })),
              ]}
              onChange={(ratio) =>
                setParameters({
                  size:
                    ratio === 'auto'
                      ? 'auto'
                      : getStudioSize(ratio, selected.resolution, mode),
                })
              }
            />
            {mode !== 'ratio' && (
              <ParameterSelect
                id='studio-resolution'
                label={t('Resolution')}
                value={
                  parameters.size === 'auto' ? 'auto' : selected.resolution
                }
                options={[
                  { value: 'auto', label: t('Auto') },
                  ...studioResolutions
                    .filter(
                      (value) =>
                        Number.parseInt(value) <= (profile?.max_resolution ?? 4)
                    )
                    .map((value) => ({ value, label: value })),
                ]}
                onChange={(resolution) =>
                  setParameters({
                    size:
                      resolution === 'auto'
                        ? 'auto'
                        : getStudioSize(
                            selected.ratio,
                            resolution as StudioResolution,
                            mode
                          ),
                  })
                }
              />
            )}
          </div>
        ) : (
          <>
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
                {(options.isMidjourney
                  ? options.sizes
                      .filter((ratio) => ratio !== 'auto')
                      .map((ratio) => ({ ratio }))
                  : imageAspectPresets
                ).map((preset) => (
                  <Button
                    key={preset.ratio}
                    type='button'
                    variant='ghost'
                    aria-pressed={
                      parameters.size !== 'auto' &&
                      selected.ratio === preset.ratio
                    }
                    onClick={() =>
                      setParameters({
                        size: getStudioSize(
                          preset.ratio,
                          selected.resolution,
                          mode
                        ),
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
            {mode !== 'ratio' && (
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
                        Number.parseInt(value) <= (profile?.max_resolution ?? 4)
                    )
                    .map((value) => (
                      <Button
                        type='button'
                        variant='ghost'
                        key={value}
                        aria-pressed={
                          parameters.size !== 'auto' &&
                          selected.resolution === value
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
            )}
          </>
        )}
        <div className='studio-parameter-grid'>
          {options.isGptImage && (
            <ParameterSelect
              id='studio-quality'
              label={t('Quality')}
              value={parameters.quality}
              options={options.qualities.map((value) => ({
                value,
                label: labels[value],
              }))}
              onChange={(quality) =>
                setParameters({
                  quality: quality as ImageParameters['quality'],
                })
              }
            />
          )}
          <ParameterSelect
            id='studio-count'
            label={options.isMidjourney ? t('Per request') : t('Image count')}
            value={String(parameters.count)}
            options={Array.from({ length: options.maxCount }, (_, index) => ({
              value: String(index + 1),
              label: options.isMidjourney
                ? t('One request')
                : t('{{count}} image(s)', { count: index + 1 }),
            }))}
            onChange={(count) => setParameters({ count: Number(count) })}
          />
          {options.isGptImage && (
            <>
              <ParameterSelect
                id='studio-format'
                label={t('File format')}
                value={parameters.format}
                options={options.formats.map((value) => ({
                  value,
                  label: labels[value] ?? value.toUpperCase(),
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
            </>
          )}
        </div>
        {options.isMidjourney && (
          <StudioMidjourneyParameters disabled={props.disabled} />
        )}
      </fieldset>
      {options.formats.includes('svg') && (
        <p className='studio-field-hint'>
          {t('Charged for every image returned by the provider.')}
        </p>
      )}
      {parameters.format === 'gif' && (
        <p className='studio-field-hint'>
          {t('GIF dimensions may be smaller than the requested resolution.')}
        </p>
      )}
      {options.isBanana && (
        <p className='studio-field-hint'>
          {t(
            'Banana returns one image per request. Size availability depends on the selected model.'
          )}
        </p>
      )}
      {parameters.format === 'jpeg' && (
        <p className='studio-field-hint'>
          {t('JPEG does not support transparency. Use PNG or WebP.')}
        </p>
      )}
    </section>
  )
}
