import { CalendarClock, RefreshCw } from 'lucide-react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  getDurationUnitOptions,
  getResetPeriodOptions,
  SUBSCRIPTION_MODEL_PROVIDERS,
} from '../constants'
import type { PlanCreateFormValues } from '../lib'

export function PlanAdvancedFields(props: { groupOptions: string[] }) {
  const { t } = useTranslation()
  const form = useFormContext<PlanCreateFormValues>()
  const durationUnit = form.watch('duration_unit')
  const resetPeriod = form.watch('quota_reset_period')
  const durationUnitOpts = getDurationUnitOptions(t)
  const resetPeriodOpts = getResetPeriodOptions(t)
  const groupOptions = props.groupOptions
  return (
    <div className='space-y-6 pt-3'>
      {/* 有效期 */}
      <section className='space-y-4'>
        <h3 className='flex items-center gap-2 text-sm font-medium'>
          <CalendarClock className='h-4 w-4' />
          {t('Duration Settings')}
        </h3>

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='duration_unit'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Duration Unit')}</FormLabel>
                <Select
                  items={durationUnitOpts.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  onValueChange={field.onChange}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {durationUnitOpts.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          {durationUnit === 'custom' ? (
            <FormField
              control={form.control}
              name='custom_seconds'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Custom Seconds')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      min={1}
                      onChange={(e) =>
                        field.onChange(Number.parseInt(e.target.value, 10) || 0)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : (
            <FormField
              control={form.control}
              name='duration_value'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Duration Value')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type='number'
                      min={1}
                      onChange={(e) =>
                        field.onChange(Number.parseInt(e.target.value, 10) || 0)
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
      </section>

      {/* 额度重置 */}
      <section className='space-y-4'>
        <h3 className='flex items-center gap-2 text-sm font-medium'>
          <RefreshCw className='h-4 w-4' />
          {t('Quota Reset')}
        </h3>

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='quota_reset_period'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Reset Cycle')}</FormLabel>
                <Select
                  items={resetPeriodOpts.map((o) => ({
                    value: o.value,
                    label: o.label,
                  }))}
                  onValueChange={field.onChange}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {resetPeriodOpts.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='quota_reset_custom_seconds'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Custom Seconds')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    min={0}
                    disabled={resetPeriod !== 'custom'}
                    onChange={(e) =>
                      field.onChange(Number.parseInt(e.target.value, 10) || 0)
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </section>

      <section className='space-y-4'>
        <h3 className='text-sm font-medium'>
          {t('Model provider restrictions')}
        </h3>
        <FormField
          control={form.control}
          name='allowed_channel_types'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Allowed model providers')}</FormLabel>
              <FormControl>
                <MultiSelect
                  options={SUBSCRIPTION_MODEL_PROVIDERS.map((o) => ({
                    value: String(o.value),
                    label: o.label,
                  }))}
                  selected={(field.value ?? []).map(String)}
                  onChange={(vals) =>
                    field.onChange(
                      vals.map(Number).filter((n) => !Number.isNaN(n))
                    )
                  }
                  placeholder={t('Allow all model providers')}
                />
              </FormControl>
              <FormDescription>
                {t(
                  'Match the requested model family, not the channel. Skip ineligible or exhausted subscriptions, then use wallet balance. Leave empty to allow all models.'
                )}{' '}
                {t(
                  'Restricted plans use the plan billing multiplier, defaulting to 1x. Unrestricted plans and wallet charges use the API key group multiplier.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='billing_ratio'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Plan billing multiplier')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='number'
                  step='any'
                  placeholder='1'
                  value={field.value ?? ''}
                  onChange={(event) =>
                    field.onChange(
                      event.target.value === ''
                        ? null
                        : event.target.valueAsNumber
                    )
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </section>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <FormField
          control={form.control}
          name='sort_order'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Sort Order')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='number'
                  onChange={(e) =>
                    field.onChange(Number.parseInt(e.target.value, 10) || 0)
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='display_sold_count'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Display Sold Count')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='number'
                  min={0}
                  onChange={(e) =>
                    field.onChange(Number.parseInt(e.target.value, 10) || 0)
                  }
                />
              </FormControl>
              <FormDescription>
                {t(
                  'Added to paid sales and deducted from limited stock. Does not create orders or revenue.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
      <FormField
        control={form.control}
        name='upgrade_group'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Upgrade Group')}</FormLabel>
            <Select
              items={[
                { value: '__none__', label: t('No Upgrade') },
                ...groupOptions.map((g) => ({ value: g, label: g })),
              ]}
              onValueChange={(v) => field.onChange(v === '__none__' ? '' : v)}
              value={field.value || ''}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={t('No Upgrade')} />
                </SelectTrigger>
              </FormControl>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value='__none__'>{t('No Upgrade')}</SelectItem>
                  {groupOptions.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name='minimum_effective_ratio'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Minimum effective multiplier')}</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                type='number'
                min={0.000001}
                step={0.01}
                onChange={(event) =>
                  field.onChange(
                    event.target.value === ''
                      ? null
                      : Number(event.target.value)
                  )
                }
              />
            </FormControl>
            <FormDescription>
              {t(
                'Optional price floor for fixed-quota GPT plans. Discounts below this effective multiplier cannot be saved.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
