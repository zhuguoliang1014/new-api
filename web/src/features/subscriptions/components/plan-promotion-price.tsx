import { TicketPercent } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatCnyCurrencyAmount } from '@/lib/currency'
import { formatNumber } from '@/lib/format'

import { formatTimestamp } from '../lib/format'
import { getPromotionQuote, getPromotionRate } from '../lib/promotion'
import type { PlanRecord } from '../types'

export function PlanPromotionPrice(props: {
  record: PlanRecord
  now: number
  variant?: 'inline' | 'banner' | 'original'
}) {
  const { t, i18n } = useTranslation()
  const rate = getPromotionRate(props.record, props.now)
  if (rate >= 1) return null
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const quote = getPromotionQuote(props.record, props.now)
  const hasCny = Number(quote.plan.price_cny || 0) > 0
  const regular = hasCny
    ? props.record.regular_price_cny
    : props.record.regular_price_amount
  const current = hasCny ? quote.plan.price_cny : quote.plan.price_amount
  if (regular == null || current == null || regular <= current) return null
  const options = {
    digitsLarge: 2,
    digitsSmall: 2,
    abbreviate: false,
    locale,
  }
  const originalPrice = hasCny
    ? formatCnyCurrencyAmount(regular, options)
    : `$${formatNumber(regular, locale)}`
  const saved = hasCny
    ? formatCnyCurrencyAmount(regular - current, options)
    : `$${formatNumber(regular - current, locale)}`
  const percent = formatNumber((1 - rate) * 100, locale)
  const chineseDiscount = locale?.toLowerCase().startsWith('zh') ?? false
  if (props.variant === 'original') {
    return (
      <p className='text-muted-foreground mt-1 text-[11px]'>
        <span className='mr-1'>{t('Regular price')}</span>
        <del>{originalPrice}</del>
      </p>
    )
  }
  if (props.variant === 'banner') {
    return (
      <div
        data-slot='plan-promotion'
        className='mt-4 flex min-w-0 items-center justify-between gap-2 rounded-xl bg-[#fff2e8] px-3 py-2.5 text-[#b54214] dark:bg-orange-950/30 dark:text-orange-300'
      >
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-x-1.5 gap-y-0.5'>
            <TicketPercent className='size-3.5 shrink-0' aria-hidden='true' />
            <p className='text-[11px] font-semibold'>
              {t('Limited-time offer')}
            </p>
            <p className='text-xs font-semibold tabular-nums'>
              <span aria-hidden='true' className='mr-1'>
                ·
              </span>
              {t('Save {{amount}}', { amount: saved })}
            </p>
          </div>
          <p
            className='mt-0.5 text-[11px] leading-snug break-words'
            title={formatTimestamp(props.record.plan.discount_ends_at || 0)}
          >
            {t('Discount until {{time}}', {
              time: formatTimestamp(
                props.record.plan.discount_ends_at || 0
              ).slice(5, 16),
            })}
          </p>
        </div>
        <div
          aria-label={t('{{percent}}% off', { percent })}
          className='shrink-0 border-l border-orange-200 pl-3 text-right dark:border-orange-800'
        >
          <p
            aria-hidden='true'
            className='text-[1.75rem] leading-none font-bold tracking-tight tabular-nums'
          >
            {chineseDiscount ? formatNumber(rate * 10, locale) : percent}
            <span className='text-sm'>
              {chineseDiscount ? t('% off') : '%'}
            </span>
          </p>
        </div>
      </div>
    )
  }
  return (
    <p
      className='text-muted-foreground mt-1 text-xs leading-relaxed'
      aria-live='polite'
    >
      <del className='mr-2'>{originalPrice}</del>
      {t('{{percent}}% off until {{time}}', {
        percent,
        time: formatTimestamp(props.record.plan.discount_ends_at || 0),
      })}
    </p>
  )
}
