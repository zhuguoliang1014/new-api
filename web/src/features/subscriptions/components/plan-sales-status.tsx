import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { getPlanSalesState } from '../lib/sales'
import type { PlanRecord } from '../types'

export function PlanSalesStatus(props: { record: PlanRecord | null }) {
  const { t, i18n } = useTranslation()
  const sales = getPlanSalesState(props.record)
  if (!sales.limited) return null
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <p
      className='text-muted-foreground my-2 text-xs leading-relaxed'
      aria-live='polite'
    >
      {t('Limited to {{limit}} · {{count}} available', {
        limit: formatNumber(sales.limit, locale),
        count: formatNumber(sales.remaining, locale),
      })}
    </p>
  )
}
