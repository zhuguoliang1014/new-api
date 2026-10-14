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
import { Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'

import { formatBillingCondition } from '../lib/billing-expression/condition-display'
import {
  getDynamicPriceEntries,
  type DynamicPriceOptions,
} from '../lib/dynamic-price'
import type { getWeeklyTimePricing } from '../lib/weekly-time-pricing'

/** The general tier table cannot represent recurring periods with group-adjusted prices. */
export function TimePricingSchedule(props: {
  schedule: NonNullable<ReturnType<typeof getWeeklyTimePricing>>
  options: DynamicPriceOptions
}) {
  const { t, i18n } = useTranslation()
  const minimum = props.schedule.periods[0].multiplier
  const maximum = props.schedule.periods.at(-1)?.multiplier ?? minimum
  return (
    <section aria-label={t('Peak and off-peak pricing')} className='space-y-3'>
      <h3 className='text-sm font-semibold'>
        {t('Peak and off-peak pricing')}
      </h3>
      <p className='text-warning flex flex-wrap items-center gap-1.5 text-sm'>
        <Clock className='size-4' />
        {t('Current multiplier: {{multiplier}}×', {
          multiplier: props.schedule.currentMultiplier,
        })}
        <span className='text-muted-foreground'>{props.schedule.timezone}</span>
      </p>
      <div className='divide-y rounded-lg border'>
        {props.schedule.periods.map((period) => {
          let label = t('Pricing period')
          if (minimum !== maximum) {
            label =
              period.multiplier === minimum ? t('Off-peak') : t('Peak period')
          }
          const entries = getDynamicPriceEntries(props.schedule.tier, {
            ...props.options,
            groupRatioMultiplier:
              (props.options.groupRatioMultiplier ?? 1) * period.multiplier,
          })
          return (
            <div key={period.multiplier} className='space-y-2 p-3'>
              <div className='flex flex-wrap items-center gap-2 text-sm'>
                <span className='font-semibold'>
                  {label} · {period.multiplier}×
                </span>
                {period.multiplier === props.schedule.currentMultiplier && (
                  <Badge variant='secondary'>{t('Current period price')}</Badge>
                )}
              </div>
              <p className='text-muted-foreground text-xs leading-relaxed'>
                {formatBillingCondition(
                  period.conditionText,
                  t,
                  i18n.language
                ) ?? period.conditionText}
              </p>
              <dl className='flex flex-wrap gap-x-5 gap-y-1 text-xs'>
                {entries.map((entry) => (
                  <div key={entry.key} className='flex items-baseline gap-1.5'>
                    <dt className='text-muted-foreground'>
                      {t(entry.shortLabel)}
                    </dt>
                    <dd className='font-mono font-semibold'>
                      {entry.formatted}
                      <span className='text-muted-foreground ml-1 font-normal'>
                        / {props.options.tokenUnit === 'K' ? '1K' : '1M'}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        })}
      </div>
      <p className='text-muted-foreground text-xs'>
        {t('Prices update automatically with the current billing period.')}
      </p>
    </section>
  )
}
