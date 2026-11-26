import { BadgeCheck, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import {
  getSavingsPercent,
  type PlanSavings,
} from '../lib/subscription-savings'

export function PlanSavingsDetails(props: {
  savings: PlanSavings
  planTitle: string
  comparisonGroup?: string
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const summary = t('Save about {{percent}}% vs wallet payment', {
    percent: getSavingsPercent(props.savings.savings),
  })

  return (
    <Dialog
      title={t('How savings are calculated')}
      description={props.planTitle}
      contentClassName='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
      trigger={
        <Button
          variant='ghost'
          aria-label={t('How savings are calculated')}
          className='h-auto min-h-9 w-full justify-between gap-2 px-0 py-1 text-left text-xs font-semibold whitespace-normal text-green-700 transition-colors hover:bg-transparent hover:text-green-800 dark:text-green-400 dark:hover:text-green-300'
        >
          <span className='flex min-w-0 items-start gap-1.5'>
            <BadgeCheck
              className='mt-0.5 size-3.5 shrink-0'
              aria-hidden='true'
            />
            <span>{summary}</span>
          </span>
          <ChevronRight className='size-3.5 shrink-0' aria-hidden='true' />
        </Button>
      }
    >
      <div className='space-y-4'>
        <p className='flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm font-semibold text-green-800 dark:bg-green-950/30 dark:text-green-300'>
          <BadgeCheck className='mt-0.5 size-4 shrink-0' aria-hidden='true' />
          {summary}
        </p>
        <dl className='divide-y rounded-lg border px-3 text-sm'>
          <div className='flex items-start justify-between gap-4 py-3'>
            <dt className='text-muted-foreground min-w-0 break-words'>
              {props.comparisonGroup
                ? t('Wallet · {{group}}', { group: props.comparisonGroup })
                : t('Wallet')}
            </dt>
            <dd className='shrink-0 font-semibold tabular-nums'>
              {formatNumber(props.savings.rechargeRatio, locale)}x
            </dd>
          </div>
          <div className='flex items-start justify-between gap-4 py-3'>
            <dt className='text-muted-foreground min-w-0 break-words'>
              {t('Subscription equivalent')}
            </dt>
            <dd className='shrink-0 font-semibold text-[#1762c2] tabular-nums dark:text-blue-300'>
              {formatNumber(props.savings.planRatio, locale)}x
            </dd>
          </div>
        </dl>
        <p className='text-muted-foreground text-xs leading-relaxed'>
          {t('Assumes quota is used before expiry or reset')}
        </p>
      </div>
    </Dialog>
  )
}
