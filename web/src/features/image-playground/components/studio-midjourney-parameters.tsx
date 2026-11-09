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

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { useImagePlaygroundStore } from '../store'
import { midjourneyParametersSchema, type MidjourneyParameters } from '../types'

function CreativeRange(props: {
  id: string
  label: string
  hint?: string
  value: number | undefined
  defaultValue: number
  max: number
  step?: number
  disabled?: boolean
  onChange: (value: number | undefined) => void
}) {
  const { t } = useTranslation()
  const value = props.value ?? props.defaultValue
  const valid =
    Number.isFinite(value) &&
    value >= 0 &&
    value <= props.max &&
    (props.step !== undefined || Number.isInteger(value))
  return (
    <div className='studio-field studio-creative-range'>
      <div className='studio-field-label'>
        <Label htmlFor={props.id}>{props.label}</Label>
        <Input
          id={props.id}
          type='number'
          min={0}
          max={props.max}
          step={props.step ?? 1}
          value={props.value ?? ''}
          placeholder={String(props.defaultValue)}
          disabled={props.disabled}
          aria-invalid={!valid}
          aria-describedby={props.hint ? `${props.id}-hint` : undefined}
          onChange={(event) =>
            props.onChange(
              event.target.value === '' ? undefined : Number(event.target.value)
            )
          }
        />
      </div>
      <Slider
        min={0}
        max={props.max}
        step={props.step ?? 1}
        value={[Math.min(props.max, Math.max(0, value))]}
        disabled={props.disabled}
        aria-label={props.label}
        onValueChange={(next) =>
          props.onChange(Array.isArray(next) ? next[0] : next)
        }
      />
      {props.hint && (
        <p id={`${props.id}-hint`} className='studio-field-hint'>
          {props.hint}
        </p>
      )}
      {!valid && (
        <p className='studio-field-error' role='alert'>
          {t('Enter a value between {{min}} and {{max}}.', {
            min: 0,
            max: props.max,
          })}
        </p>
      )}
    </div>
  )
}

export function StudioMidjourneyParameters(props: { disabled?: boolean } = {}) {
  const { t } = useTranslation()
  const options = useImagePlaygroundStore((state) => state.parameters.mj) ?? {}
  const referenceCount = useImagePlaygroundStore(
    (state) => state.references.length
  )
  const setParameters = useImagePlaygroundStore((state) => state.setParameters)
  const validation = midjourneyParametersSchema.safeParse(options)
  const invalidFields = validation.success
    ? []
    : validation.error.issues.map((issue) => issue.path[0])
  const setOptions = (patch: Partial<MidjourneyParameters>) => {
    if (!props.disabled) setParameters({ mj: { ...options, ...patch } })
  }
  return (
    <div className='studio-mj-controls'>
      <div className='studio-field-label'>
        <h3>{t('Midjourney controls')}</h3>
        <Button
          disabled={props.disabled}
          type='button'
          size='sm'
          variant='ghost'
          onClick={() => setParameters({ mj: {} })}
        >
          {t('Reset')}
        </Button>
      </div>
      <p className='studio-field-hint'>
        {t(
          'Standard quality · HD off. Creative controls keep the current price tier.'
        )}
      </p>
      <div className='studio-mj-toggles'>
        <div className='studio-field-label'>
          <Label htmlFor='studio-mj-raw'>{t('Raw mode')}</Label>
          <Switch
            disabled={props.disabled}
            id='studio-mj-raw'
            checked={options.raw ?? false}
            onCheckedChange={(raw) => setOptions({ raw })}
          />
        </div>
        <div className='studio-field-label'>
          <Label htmlFor='studio-mj-tile'>{t('Seamless tile')}</Label>
          <Switch
            disabled={props.disabled}
            id='studio-mj-tile'
            checked={options.tile ?? false}
            onCheckedChange={(tile) => setOptions({ tile })}
          />
        </div>
      </div>
      <CreativeRange
        disabled={props.disabled}
        id='studio-mj-stylize'
        label={t('Stylization')}
        value={options.stylize}
        defaultValue={100}
        max={1000}
        onChange={(stylize) => setOptions({ stylize })}
        hint={t('Higher values give Midjourney more artistic freedom.')}
      />
      <CreativeRange
        disabled={props.disabled}
        id='studio-mj-chaos'
        label={t('Variety')}
        value={options.chaos}
        defaultValue={0}
        max={100}
        onChange={(chaos) => setOptions({ chaos })}
        hint={t('Increase variation between the images in one request.')}
      />
      <CreativeRange
        disabled={props.disabled}
        id='studio-mj-weird'
        label={t('Weirdness')}
        value={options.weird}
        defaultValue={0}
        max={3000}
        onChange={(weird) => setOptions({ weird })}
      />
      <div className='studio-field'>
        <Label htmlFor='studio-mj-seed'>{t('Random seed')}</Label>
        <Input
          disabled={props.disabled}
          id='studio-mj-seed'
          type='number'
          min={0}
          max={4294967295}
          step={1}
          value={options.seed ?? ''}
          placeholder={t('Random each time')}
          aria-invalid={invalidFields.includes('seed')}
          onChange={(event) =>
            setOptions({
              seed:
                event.target.value === ''
                  ? undefined
                  : Number(event.target.value),
            })
          }
        />
        <p className='studio-field-hint'>
          {t(
            'A seed can help compare changes; identical results are not guaranteed.'
          )}
        </p>
        {invalidFields.includes('seed') && (
          <p className='studio-field-error' role='alert'>
            {t('Enter a whole number from 0 to 4294967295.')}
          </p>
        )}
      </div>
      <div className='studio-field'>
        <Label htmlFor='studio-mj-negative'>{t('Negative prompt')}</Label>
        <Textarea
          disabled={props.disabled}
          id='studio-mj-negative'
          maxLength={4000}
          rows={2}
          value={options.negative_prompt ?? ''}
          placeholder={t('Describe what to leave out of the image')}
          onChange={(event) =>
            setOptions({ negative_prompt: event.target.value || undefined })
          }
        />
      </div>
      <CreativeRange
        id='studio-mj-iw'
        label={t('Image reference weight')}
        value={options.iw}
        defaultValue={1}
        max={3}
        step={0.1}
        disabled={props.disabled || referenceCount === 0}
        hint={
          referenceCount === 0
            ? t('Add a reference image above to set its influence.')
            : undefined
        }
        onChange={(iw) => setOptions({ iw })}
      />
      <Accordion>
        <AccordionItem value='references'>
          <AccordionTrigger>
            {t('Character, style and depth references')}
          </AccordionTrigger>
          <AccordionContent>
            <div className='studio-mj-references'>
              {(
                [
                  {
                    field: 'cref',
                    weight: 'cw',
                    label: t('Character reference'),
                    weightLabel: t('Character weight'),
                    max: 100,
                    defaultValue: 100,
                  },
                  {
                    field: 'sref',
                    weight: 'sw',
                    label: t('Style reference'),
                    weightLabel: t('Style weight'),
                    max: 1000,
                    defaultValue: 100,
                  },
                  {
                    field: 'dref',
                    weight: 'dw',
                    label: t('Depth reference'),
                    weightLabel: t('Depth weight'),
                    max: 100,
                    defaultValue: 1,
                  },
                ] as const
              ).map((reference) => (
                <div key={reference.field} className='studio-mj-reference'>
                  <div className='studio-field'>
                    <Label htmlFor={`studio-mj-${reference.field}`}>
                      {reference.label}
                    </Label>
                    <Input
                      disabled={props.disabled}
                      id={`studio-mj-${reference.field}`}
                      type='url'
                      value={options[reference.field] ?? ''}
                      placeholder='https://…'
                      aria-invalid={invalidFields.includes(reference.field)}
                      onChange={(event) => {
                        const source = event.target.value || undefined
                        setOptions({
                          [reference.field]: source,
                          ...(source ? {} : { [reference.weight]: undefined }),
                        })
                      }}
                    />
                    {invalidFields.includes(reference.field) && (
                      <p className='studio-field-error' role='alert'>
                        {t('Enter a public HTTP or HTTPS image URL.')}
                      </p>
                    )}
                  </div>
                  <CreativeRange
                    id={`studio-mj-${reference.weight}`}
                    label={reference.weightLabel}
                    value={options[reference.weight]}
                    defaultValue={reference.defaultValue}
                    max={reference.max}
                    step={reference.weight === 'dw' ? 0.1 : undefined}
                    disabled={props.disabled || !options[reference.field]}
                    onChange={(value) =>
                      setOptions({ [reference.weight]: value })
                    }
                  />
                </div>
              ))}
              <p className='studio-field-hint'>
                {t('Reference links must be accessible to the image provider.')}
              </p>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  )
}
