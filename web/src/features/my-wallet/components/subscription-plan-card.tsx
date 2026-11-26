import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono'
import {
  ArrowRight,
  RotateCcw,
  ShoppingBag,
  Snowflake,
  Timer,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { PlanPromotionPrice } from '@/features/subscriptions/components/plan-promotion-price'
import { PlanSalesStatus } from '@/features/subscriptions/components/plan-sales-status'
import { DEFAULT_SUBSCRIPTION_GROUP } from '@/features/subscriptions/constants'
import {
  formatDuration,
  formatResetPeriod,
  formatTimestamp,
} from '@/features/subscriptions/lib'
import { getPlanSubtitle } from '@/features/subscriptions/lib/format'
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

import type { PlanSavings } from '../lib/subscription-savings'
import { PlanSavingsDetails } from './plan-savings-details'

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

const purchaseButtonClassName =
  'h-auto min-h-11 w-full justify-center gap-3 rounded-[8px] bg-[#216bd1] px-3 py-2 text-sm font-semibold whitespace-normal text-white transition-colors hover:bg-[#1a5ab7] dark:bg-blue-600 dark:hover:bg-blue-700'

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
  const comparisonGroup = savings?.comparisonGroup ?? props.comparisonGroup

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
    { label: t('Quota Reset'), value: resetPeriod, icon: RotateCcw },
    {
      label: t('Purchase Count'),
      icon: ShoppingBag,
      value:
        limit > 0
          ? t('Purchased {{count}} of {{limit}}', {
              count: formatNumber(count, locale),
              limit: formatNumber(limit, locale),
            })
          : t('Unlimited purchases'),
    },
    ...((plan.freeze_cards ?? 0) > 0
      ? [
          {
            label: t('Bonus freeze cards'),
            value: t('{{count}} cards', {
              count: formatNumber(plan.freeze_cards ?? 0, locale),
            }),
            icon: Snowflake,
            highlight: true,
          },
        ]
      : []),
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
        'relative min-w-0 gap-0 rounded-2xl border py-0 shadow-none ring-0 transition-colors duration-200',
        isRecommended
          ? 'border-blue-300 dark:border-blue-700'
          : 'border-border hover:border-foreground/25'
      )}
    >
      <CardContent className='flex h-full min-w-0 flex-col p-4'>
        <div data-slot='plan-identity' className='min-h-16'>
          <div className='flex items-start justify-between gap-3'>
            <div className='flex min-w-0 flex-1 items-center gap-2.5'>
              <span
                data-slot='plan-provider-icon'
                aria-hidden='true'
                className='text-foreground bg-background flex size-9 shrink-0 items-center justify-center rounded-[10px] border'
              >
                <OpenAI size={20} />
              </span>
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                  <h3
                    id={`subscription-plan-${plan.id}`}
                    title={plan.title || t('Subscription Plans')}
                    className='text-base leading-snug font-semibold tracking-tight break-words'
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
              </div>
            </div>
            <Badge
              data-slot='plan-duration'
              variant='secondary'
              className='bg-muted text-muted-foreground h-auto max-w-[35%] shrink-0 rounded-[6px] px-1.5 py-1 text-[10px] whitespace-normal'
            >
              {duration}
            </Badge>
          </div>

          <p className='text-muted-foreground mt-3 text-[11px] leading-relaxed break-words'>
            {t('Subscription groups: {{groups}}', {
              groups: (
                plan.allowed_groups ?? [DEFAULT_SUBSCRIPTION_GROUP]
              ).join('、'),
            })}
          </p>
          {getPlanSubtitle(plan.subtitle) && (
            <p
              title={getPlanSubtitle(plan.subtitle)}
              className='text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug break-words'
            >
              {getPlanSubtitle(plan.subtitle)}
            </p>
          )}
        </div>

        <div
          data-slot='plan-price-quota'
          className='mt-3 grid min-h-20 grid-cols-2 gap-3'
        >
          <div className='min-w-0'>
            <div className='text-muted-foreground flex flex-wrap items-baseline gap-x-1 text-[11px]'>
              <span>{showPromotion ? t('Discounted price') : t('Price')}</span>
              <span className='whitespace-nowrap'>/ {duration}</span>
            </div>
            <p
              className={cn(
                priceLabel.length > 8 ? 'text-lg' : 'text-[1.75rem]',
                'mt-1.5 leading-tight font-semibold tracking-tight break-words tabular-nums'
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
            </div>
          </div>
          <div
            data-slot='plan-quota'
            className='border-border/70 min-w-0 border-l pl-4 text-[#1762c2] dark:text-blue-300'
          >
            <p className='text-[11px] font-semibold'>{t('Available Quota')}</p>
            <p
              className={cn(
                quotaLabel.length > 8 ? 'text-lg' : 'text-[1.75rem]',
                'mt-1.5 leading-tight font-semibold tracking-tight break-words tabular-nums'
              )}
            >
              {quotaLabel}
            </p>
            <p className='text-muted-foreground mt-2 text-[11px]'>
              {t('Site credits')}
            </p>
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
                ? 'bg-[#fff2e8] text-[#b54214] dark:bg-orange-950/30 dark:text-orange-300'
                : 'border-border bg-muted/50 text-muted-foreground'
            )}
          >
            <Timer className='size-3.5 shrink-0' aria-hidden='true' />
            <span>{saleHint}</span>
          </div>
        )}

        <div className='pt-3'>
          <div
            data-slot='plan-benefits-content'
            className='border-border/70 border-t pt-3'
          >
            {savings && (
              <div data-slot='plan-savings' className='mb-2'>
                <PlanSavingsDetails
                  savings={savings}
                  planTitle={plan.title || t('Subscription')}
                  comparisonGroup={comparisonGroup}
                />
              </div>
            )}
            <dl data-slot='plan-benefits' className='space-y-2'>
              {details.map((detail) => (
                <div
                  key={detail.label}
                  className='flex min-w-0 items-start justify-between gap-3 text-xs leading-5'
                >
                  <dt className='text-muted-foreground flex min-w-0 items-center gap-2'>
                    <detail.icon
                      className='size-3.5 shrink-0 opacity-70'
                      aria-hidden='true'
                    />
                    <span className='break-words'>{detail.label}</span>
                  </dt>
                  <dd
                    className={cn(
                      'min-w-0 text-right font-medium break-words',
                      detail.highlight && 'text-[#1762c2] dark:text-blue-300'
                    )}
                  >
                    {detail.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div data-slot='plan-purchase-area' className='mt-auto pt-3'>
          <div
            data-slot='plan-stock'
            className='mb-2 flex min-h-4 flex-wrap items-center gap-x-3 gap-y-1'
          >
            <PlanSalesStatus
              record={p}
              variant='split'
              className='my-0 w-full text-[11px]'
            />
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
              <TooltipTrigger
                render={
                  <div
                    tabIndex={0}
                    className='focus-visible:outline-ring rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2'
                  />
                }
              >
                <Button
                  variant='default'
                  className={purchaseButtonClassName}
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
              variant='default'
              className={cn(
                purchaseButtonClassName,
                sale.status === 'upcoming' && 'tabular-nums'
              )}
              disabled={!purchasable}
              onClick={() => {
                props.onPurchase(p)
              }}
            >
              <span className='min-w-0'>{buttonLabel}</span>
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
