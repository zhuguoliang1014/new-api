import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'

interface PromotionValues {
  discount_rate?: number | null
  discount_starts_at?: number
  discount_ends_at?: number
  limited_sale?: boolean
  minimum_effective_ratio?: number | null
}

export function PlanPromotionFields(props: {
  quotaUSD: number
  priceCNY: number
  billingRatio: number
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  // The shared number formatter rounds to two decimals; price floors need four.
  const multiplierFormat = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 4,
  })
  const form = useFormContext<PromotionValues>()
  const discount = Number(form.watch('discount_rate') ?? 1)
  const regularRatio =
    props.quotaUSD > 0
      ? (props.priceCNY / props.quotaUSD) * props.billingRatio
      : 0
  return (
    <section className='space-y-4'>
      <h3 className='text-sm font-medium'>{t('Scheduled price discount')}</h3>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Discount changes the purchase price only. Purchased quota and billing terms stay fixed. Regular prices resume automatically when the discount ends.'
        )}
      </p>
      {regularRatio > 0 && (
        <p className='rounded-md border px-3 py-2 text-sm tabular-nums'>
          {t(
            'Regular effective multiplier: {{regular}}× · discounted: {{discounted}}×',
            {
              regular: multiplierFormat.format(regularRatio),
              discounted: multiplierFormat.format(regularRatio * discount),
            }
          )}
        </p>
      )}
      <FormField
        control={form.control}
        name='discount_rate'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Discount rate')}</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? 1}
                type='number'
                min={0.01}
                max={1}
                step={0.01}
                onChange={(event) =>
                  field.onChange(
                    event.target.value === '' ? '' : Number(event.target.value)
                  )
                }
              />
            </FormControl>
            <FormDescription>
              {t(
                '1 means regular price; 0.8 means 20% off. Set an end time for any discount.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <FormField
          control={form.control}
          name='discount_starts_at'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Discount start time')}</FormLabel>
              <FormControl>
                <DateTimePicker
                  value={field.value ? new Date(field.value * 1000) : undefined}
                  onChange={(date) =>
                    field.onChange(date ? Math.floor(date.getTime() / 1000) : 0)
                  }
                />
              </FormControl>
              <FormDescription>
                {t('Leave empty to start the discount immediately')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='discount_ends_at'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Discount end time')}</FormLabel>
              <FormControl>
                <DateTimePicker
                  value={field.value ? new Date(field.value * 1000) : undefined}
                  onChange={(date) =>
                    field.onChange(date ? Math.floor(date.getTime() / 1000) : 0)
                  }
                />
              </FormControl>
              <FormDescription>
                {t(
                  'The product stays on sale at its regular price after this time'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
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
      <FormField
        control={form.control}
        name='limited_sale'
        render={({ field }) => (
          <FormItem className='flex items-start justify-between gap-4 rounded-md border p-3'>
            <div>
              <FormLabel>{t('Limited edition')}</FormLabel>
              <FormDescription>
                {t(
                  'When enabled, a sales limit of 0 means no stock. Increase the total sales limit to restock; sales never reset automatically.'
                )}
              </FormDescription>
            </div>
            <FormControl>
              <Switch
                checked={field.value ?? false}
                onCheckedChange={field.onChange}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </section>
  )
}
