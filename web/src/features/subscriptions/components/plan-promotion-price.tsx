import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatCnyCurrencyAmount } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { formatTimestamp } from '../lib/format'
import { getPromotionRate } from '../lib/promotion'
import type { PlanRecord } from '../types'

export function PlanPromotionPrice(props: { record: PlanRecord; now: number }) {
  const { t, i18n } = useTranslation()
  const rate = getPromotionRate(props.record, props.now)
  if (rate >= 1 || props.record.regular_price_cny == null) return null
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <p
      className='text-muted-foreground mt-1 text-xs leading-relaxed'
      aria-live='polite'
    >
      <span className='mr-2 line-through'>
        {formatCnyCurrencyAmount(props.record.regular_price_cny, {
          digitsLarge: 2,
          digitsSmall: 2,
          abbreviate: false,
          locale,
        })}
      </span>
      {t('{{percent}}% off until {{time}}', {
        percent: formatNumber(Math.round((1 - rate) * 100), locale),
        time: formatTimestamp(props.record.plan.discount_ends_at || 0),
      })}
    </p>
  )
}
