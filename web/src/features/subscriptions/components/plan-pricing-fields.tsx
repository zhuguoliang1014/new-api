import { useState } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { SideDrawerSectionHeader } from '@/components/drawer-layout'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { toIntlLocale } from '@/i18n/languages'
import { formatCnyCurrencyAmount } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import type { PlanCreateFormValues } from '../lib'
import { calculatePlanQuotaUSD } from '../lib/plan-pricing'

export function PlanPricingFields(props: {
  initialAutomatic: boolean
  quotaUSD: number
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const form = useFormContext<PlanCreateFormValues>()
  const [automatic, setAutomatic] = useState(props.initialAutomatic)
  const price = Number(form.watch('price_cny') || 0)
  const quota = props.quotaUSD
  const ratio = Number(form.watch('pricing_ratio') || 0)
  const discount = Number(form.watch('discount_rate') ?? 1)
  const providers = form.watch('allowed_channel_types') ?? []
  const isGPTMonthly =
    providers.length === 1 &&
    providers[0] === 1 &&
    form.watch('duration_unit') === 'month' &&
    form.watch('duration_value') === 1 &&
    form.watch('quota_reset_period') === 'never' &&
    (form.watch('billing_ratio') ?? 1) === 1
  const auto = automatic && isGPTMonthly
  const updateQuota = (newPrice: number, newRatio: number) => {
    if (newPrice > 0 && newRatio > 0) {
      form.setValue('price_amount', calculatePlanQuotaUSD(newPrice, newRatio), {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
  }
  return (
    <div className='space-y-4'>
      <SideDrawerSectionHeader
        title={t('Regular pricing')}
        description={t(
          'Set the regular selling price and how much usage it includes.'
        )}
      />
      {isGPTMonthly && (
        <ToggleGroup
          value={[auto ? 'automatic' : 'manual']}
          onValueChange={(value) => {
            const next = value[0]
            if (!next) return
            setAutomatic(next === 'automatic')
            if (next === 'manual') form.setValue('pricing_ratio', undefined)
            if (next === 'automatic') {
              const target = ratio > 0 ? ratio : price / Math.max(quota, 1)
              form.setValue('pricing_ratio', target)
              updateQuota(price, target)
            }
          }}
          variant='outline'
          className='w-full'
        >
          <ToggleGroupItem value='automatic' className='min-w-0 flex-1'>
            {t('Price + multiplier')}
          </ToggleGroupItem>
          <ToggleGroupItem value='manual' className='min-w-0 flex-1'>
            {t('Set quota manually')}
          </ToggleGroupItem>
        </ToggleGroup>
      )}
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <FormField
          control={form.control}
          name='price_cny'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Regular price (CNY)')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type='number'
                  min={0.01}
                  step={0.01}
                  placeholder='99.00'
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    field.onChange(next)
                    if (auto) updateQuota(next, ratio)
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {auto ? (
          <FormField
            control={form.control}
            name='pricing_ratio'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Regular effective multiplier')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    value={field.value ?? ''}
                    type='number'
                    min={0.000001}
                    step='any'
                    placeholder='0.28'
                    onChange={(event) => {
                      const next = Number(event.target.value)
                      field.onChange(next)
                      updateQuota(price, next)
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <FormField
            control={form.control}
            name='price_amount'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('USD Quota Amount')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type='number'
                    min={0}
                    step={0.000001}
                    onChange={(event) =>
                      field.onChange(Number(event.target.value))
                    }
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>
      {auto && (
        <p className='text-muted-foreground text-xs'>
          {t(
            'Quota is calculated automatically: regular price ÷ regular multiplier. Promotions change the selling price, never the quota.'
          )}
        </p>
      )}
      <div
        className='bg-muted/30 grid grid-cols-2 gap-4 rounded-lg border p-4'
        aria-live='polite'
      >
        <div className='min-w-0'>
          <p className='text-muted-foreground text-xs'>
            {t('Included quota (USD)')}
          </p>
          <p className='mt-1 text-lg font-semibold break-words tabular-nums'>
            ${formatNumber(quota, locale)}
          </p>
        </div>
        <div className='min-w-0'>
          <p className='text-muted-foreground text-xs'>
            {t('Price after discount')}
          </p>
          <p className='mt-1 text-lg font-semibold break-words tabular-nums'>
            {formatCnyCurrencyAmount(
              Math.round((price * discount + Number.EPSILON) * 100) / 100,
              { digitsLarge: 2, digitsSmall: 2, abbreviate: false, locale }
            )}
          </p>
        </div>
      </div>
      <p className='text-muted-foreground text-xs'>
        {isGPTMonthly
          ? t('GPT only · one month · shared monthly quota')
          : t(
              'This plan uses custom entitlement settings. Review Advanced Settings before changing its pricing.'
            )}
      </p>
      {!auto && (
        <FormDescription>
          {t(
            'Manual mode preserves existing quota settings until you change them.'
          )}
        </FormDescription>
      )}
    </div>
  )
}
