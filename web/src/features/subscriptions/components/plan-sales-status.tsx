import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getPlanSalesState } from '../lib/sales'
import type { PlanRecord } from '../types'

export function PlanSalesStatus(props: {
  record: PlanRecord | null
  className?: string
  variant?: 'inline' | 'split'
}) {
  const { t, i18n } = useTranslation()
  const sales = getPlanSalesState(props.record)
  if (!sales.limited) return null
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  if (props.variant === 'split') {
    return (
      <div
        className={cn('text-muted-foreground space-y-1', props.className)}
        aria-live='polite'
        aria-label={t('Limited to {{limit}} · {{count}} available', {
          limit: formatNumber(sales.limit, locale),
          count: formatNumber(sales.remaining, locale),
        })}
      >
        <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
          <span>
            {t('Limited to {{limit}}', {
              limit: formatNumber(sales.limit, locale),
            })}
          </span>
          <span>
            {t('{{count}} available', {
              count: formatNumber(sales.remaining, locale),
            })}
          </span>
        </div>
        {sales.reserved > 0 && (
          <p>
            {t('Payment reservations: {{count}}', {
              count: formatNumber(sales.reserved, locale),
            })}
          </p>
        )}
      </div>
    )
  }
  return (
    <p
      className={cn(
        'text-muted-foreground my-2 text-xs leading-relaxed',
        props.className
      )}
      aria-live='polite'
    >
      {t('Limited to {{limit}} · {{count}} available', {
        limit: formatNumber(sales.limit, locale),
        count: formatNumber(sales.remaining, locale),
      })}
      {sales.reserved > 0 && (
        <span className='ml-2 inline-block'>
          {t('Payment reservations: {{count}}', {
            count: formatNumber(sales.reserved, locale),
          })}
        </span>
      )}
    </p>
  )
}
