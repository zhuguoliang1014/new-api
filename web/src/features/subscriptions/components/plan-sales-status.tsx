import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getPlanSalesState } from '../lib/sales'
import type { PlanRecord } from '../types'

export function PlanSalesStatus(props: {
  record: PlanRecord | null
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const sales = getPlanSalesState(props.record)
  if (!sales.limited) return null
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
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
