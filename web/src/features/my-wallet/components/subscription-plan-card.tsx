import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono'
import { ArrowRight, Timer } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PlanPromotionPrice } from '@/features/subscriptions/components/plan-promotion-price'
import { PlanSalesStatus } from '@/features/subscriptions/components/plan-sales-status'
import {
  formatDuration,
  formatResetPeriod,
  formatTimestamp,
} from '@/features/subscriptions/lib'
import {
  getPromotionQuote,
  getPromotionRate,
} from '@/features/subscriptions/lib/promotion'
import { getPlanSalesState } from '@/features/subscriptions/lib/sales'
import type {
  PlanRecord,
  SubscriptionPlan,
} from '@/features/subscriptions/types'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatCnyCurrencyAmount,
  formatQuotaWithCurrency,
} from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  getSavingsPercent,
  type PlanSavings,
} from '../lib/subscription-savings'

interface SubscriptionPlanCardProps {
  record: PlanRecord
  now: number
  recommended: boolean
  purchaseCount: number
  paymentEnabled: boolean
  savings?: PlanSavings
  comparisonGroup?: string
  onPurchase: (record: PlanRecord) => void
}

type SaleStatus = 'open' | 'upcoming' | 'live' | 'ended'

interface SaleWindow {
  status: SaleStatus
  startsAt: number
  expiresAt: number
  startsIn: number
  endsIn: number
}

function computeSaleWindow(plan: SubscriptionPlan, nowSec: number): SaleWindow {
  const startsAt = Number(plan.starts_at || 0)
  const expiresAt = Number(plan.expires_at || 0)
  const startsIn = startsAt > 0 ? startsAt - nowSec : 0
  const endsIn = expiresAt > 0 ? expiresAt - nowSec : 0

  let status: SaleStatus = 'open'
  if (startsAt > 0 && nowSec < startsAt) status = 'upcoming'
  else if (expiresAt > 0 && nowSec >= expiresAt) status = 'ended'
  else if (startsAt > 0 || expiresAt > 0) status = 'live'

  return { status, startsAt, expiresAt, startsIn, endsIn }
}

function formatRelativeDuration(totalSeconds: number, dayUnit: string): string {
  const total = Math.max(0, Math.floor(totalSeconds))
  if (total <= 0) return '00:00:00'
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  if (days > 0) return `${days} ${dayUnit} ${hh}:${mm}:${ss}`
  return `${hh}:${mm}:${ss}`
}

export function SubscriptionPlanCard(props: SubscriptionPlanCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfigStore((state) => state.config.currency)
  const p = getPromotionQuote(props.record, props.now)
  const plan = p?.plan
  if (!plan) return null

  const totalAmount = Number(plan.total_amount || 0)
  const priceUsd = Number(plan.price_amount || 0)
  const priceCny = Number(plan.price_cny || 0)
  const hasCny = priceCny > 0
  const priceLabel = hasCny
    ? formatCnyCurrencyAmount(priceCny, {
        digitsLarge: 2,
        digitsSmall: 2,
        abbreviate: false,
        locale,
      })
    : `$${formatNumber(priceUsd, locale)}`
  const duration = formatDuration(plan, t)

  const isPopular = props.recommended
  const limit = Number(plan.max_purchase_per_user || 0)
  const count = props.purchaseCount
  const reached = limit > 0 && count >= limit
  const sales = getPlanSalesState(p)
  const soldCount = Number(p.sold_count || 0)
  const resetPeriod = formatResetPeriod(plan, t)
  const savings = props.savings

  const sale = computeSaleWindow(plan, props.now)
  const isSaleable = sale.status !== 'upcoming' && sale.status !== 'ended'
  const purchasable =
    isSaleable && !reached && !sales.unavailable && props.paymentEnabled
  const isRecommended = isPopular && purchasable
  const showPromotion = isSaleable && getPromotionRate(p, props.now) < 1

  const quotaLabel =
    totalAmount > 0
      ? formatQuotaWithCurrency(totalAmount, {
          digitsLarge: 2,
          digitsSmall: 4,
          abbreviate: true,
          locale,
        })
      : t('Unlimited')

  const details = [
    { label: t('Quota Reset'), value: resetPeriod },
    {
      label: t('Purchase Count'),
      value:
        limit > 0
          ? t('Purchased {{count}} of {{limit}}', {
              count: formatNumber(count, locale),
              limit: formatNumber(limit, locale),
            })
          : t('Unlimited purchases'),
    },
  ]

  let saleHint: string | null = null
  let saleHintLabel = t('Ends in')
  if (sale.status === 'ended') {
    saleHintLabel = t('Sale ended at')
    saleHint = `${saleHintLabel} ${formatTimestamp(sale.expiresAt)}`
  } else if (sale.status === 'live' && sale.expiresAt > 0) {
    saleHint = `${saleHintLabel} ${formatRelativeDuration(sale.endsIn, t('days'))}`
  } else if (sale.status === 'upcoming') {
    saleHintLabel = t('Starts in')
    saleHint = `${saleHintLabel} ${formatRelativeDuration(sale.startsIn, t('days'))}`
  }

  let buttonLabel = t('Subscribe Now')
  if (sales.soldOut) {
    buttonLabel = t('Sold Out')
  } else if (sales.unavailable) {
    buttonLabel = t('Places reserved')
  } else if (reached) {
    buttonLabel = t('Limit Reached')
  } else if (sale.status === 'upcoming') {
    buttonLabel = t('Not Started')
  } else if (sale.status === 'ended') {
    buttonLabel = t('Sale Ended')
  }

  return (
    <Card
      role='article'
      aria-labelledby={`subscription-plan-${plan.id}`}
      data-card-hover='false'
      className={cn(
        'relative min-w-0 gap-0 rounded-[12px] border py-0 shadow-none ring-0 transition-colors duration-200',
        isRecommended
          ? 'border-foreground/25'
          : 'border-border hover:border-foreground/25'
      )}
    >
      <CardContent className='flex h-full min-w-0 flex-col p-4'>
        <div className='flex items-start justify-between gap-2'>
          <div className='flex min-w-0 flex-1 items-start gap-2'>
            <span
              data-slot='plan-provider-icon'
              aria-hidden='true'
              className='text-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center'
            >
              <OpenAI size={20} />
            </span>
            <div className='min-w-0 flex-1'>
              <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                <h3
                  id={`subscription-plan-${plan.id}`}
                  title={plan.title || t('Subscription Plans')}
                  className='font-serif text-lg leading-snug font-semibold tracking-tight break-words'
                >
                  {plan.title || t('Subscription Plans')}
                </h3>
                {isRecommended && (
                  <StatusBadge
                    label={t('Recommended')}
                    variant='neutral'
                    type='text'
                    copyable={false}
                    className='text-muted-foreground text-[10px]'
                  />
                )}
              </div>
              {plan.subtitle && (
                <p
                  title={plan.subtitle}
                  className='text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug break-words'
                >
                  {plan.subtitle}
                </p>
              )}
            </div>
          </div>
        </div>

        {showPromotion && (
          <PlanPromotionPrice record={p} now={props.now} variant='banner' />
        )}
        {saleHint && (
          <div
            data-slot='plan-sale-notice'
            role={sale.status === 'ended' ? 'note' : 'timer'}
            aria-label={saleHintLabel}
            aria-live='off'
            className={cn(
              'mt-3 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug font-medium tabular-nums',
              sale.status === 'live'
                ? 'border-rose-100 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300'
                : 'border-border bg-muted/50 text-muted-foreground'
            )}
          >
            <Timer className='size-3.5 shrink-0' aria-hidden='true' />
            <span>{saleHint}</span>
          </div>
        )}

        <div
          data-slot='plan-price-quota'
          className='mt-3 grid grid-cols-2 gap-2'
        >
          <div className='min-w-0'>
            <p className='text-muted-foreground text-[11px]'>
              {showPromotion ? t('Discounted price') : t('Price')}
            </p>
            <p
              className={cn(
                priceLabel.length > 8 ? 'text-xl' : 'text-2xl',
                'mt-1 leading-tight font-semibold tracking-tight break-words tabular-nums'
              )}
            >
              {priceLabel}
            </p>
            <div className='flex flex-wrap items-baseline gap-x-2'>
              {showPromotion && (
                <PlanPromotionPrice
                  record={p}
                  now={props.now}
                  variant='original'
                />
              )}
              <p className='text-muted-foreground mt-1 text-[11px] whitespace-nowrap'>
                / {duration}
              </p>
            </div>
          </div>
          <div className='min-w-0 border-l pl-2'>
            <p className='text-muted-foreground text-[11px]'>
              {t('Available Quota')}
            </p>
            <p
              className={cn(
                quotaLabel.length > 8 ? 'text-xl' : 'text-2xl',
                'mt-1 leading-tight font-semibold tracking-tight break-words tabular-nums'
              )}
            >
              {quotaLabel}
            </p>
          </div>
        </div>
        <div className='min-w-0'>
          {savings && (
            <div data-slot='plan-savings' className='mt-1'>
              <Accordion>
                <AccordionItem value='savings-details'>
                  <AccordionTrigger
                    aria-label={t('How savings are calculated')}
                    className='gap-2 py-1 text-xs font-semibold text-green-700 dark:text-green-400'
                  >
                    <span>
                      {t('Save about {{percent}}% vs wallet payment', {
                        percent: getSavingsPercent(savings.savings),
                      })}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className='text-muted-foreground space-y-2 pt-1 text-xs leading-relaxed'>
                    <dl className='space-y-1'>
                      <div className='flex items-start justify-between gap-3'>
                        <dt className='min-w-0 break-words'>
                          {props.comparisonGroup
                            ? t('Wallet GPT · {{group}}', {
                                group: props.comparisonGroup,
                              })
                            : t('Wallet GPT')}
                        </dt>
                        <dd className='shrink-0 tabular-nums'>
                          {formatNumber(savings.rechargeRatio, locale)}x
                        </dd>
                      </div>
                      <div className='flex items-start justify-between gap-3'>
                        <dt>{t('Subscription equivalent')}</dt>
                        <dd className='shrink-0 tabular-nums'>
                          {formatNumber(savings.planRatio, locale)}x
                        </dd>
                      </div>
                    </dl>
                    <div>
                      {t('Assumes quota is used before expiry or reset')}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          )}
        </div>

        <dl className='mt-2 grid grid-cols-2 gap-2 border-t pt-2'>
          {details.map((detail) => (
            <div key={detail.label} className='min-w-0 space-y-1 text-[11px]'>
              <dt className='text-muted-foreground min-w-0 break-words'>
                {detail.label}
              </dt>
              <dd className='font-medium break-words'>{detail.value}</dd>
            </div>
          ))}
        </dl>

        <div className='mt-auto pt-2'>
          <div
            data-slot='plan-stock'
            className='mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 empty:hidden'
          >
            <PlanSalesStatus record={p} className='my-0 text-[11px]' />
            {soldCount > 0 && (
              <p className='text-muted-foreground text-[11px]'>
                {t('Sold {{count}}', {
                  count: formatNumber(soldCount, locale),
                })}
              </p>
            )}
          </div>
          {!props.paymentEnabled &&
          isSaleable &&
          !reached &&
          !sales.unavailable ? (
            <Tooltip>
              <TooltipTrigger render={<div />}>
                <Button
                  variant='outline'
                  className='h-auto min-h-11 w-full px-3 py-2 text-sm whitespace-normal'
                  disabled
                >
                  {t('Online payment disabled by admin')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('Contact the administrator to re-enable online payment.')}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant='outline'
              className={cn(
                'h-auto min-h-11 w-full justify-between gap-3 rounded-[8px] px-3 py-2 text-sm font-medium whitespace-normal',
                sale.status === 'upcoming' && 'tabular-nums'
              )}
              disabled={!purchasable}
              onClick={() => {
                props.onPurchase(p)
              }}
            >
              <span className='min-w-0 flex-1'>{buttonLabel}</span>
              {purchasable && (
                <ArrowRight className='size-4' aria-hidden='true' />
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
