import { ArrowRight, Crown, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import {
  formatDuration,
  formatResetPeriod,
  formatTimestamp,
} from '@/features/subscriptions/lib'
import type {
  PlanRecord,
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { toIntlLocale } from '@/i18n/languages'
import {
  formatCnyCurrencyAmount,
  formatQuotaWithCurrency,
} from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { getLobeIcon } from '@/lib/lobe-icon'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import type { MyWalletTopupInfo } from '../types'
import { LocalSubscriptionPurchaseDialog } from './local-subscription-purchase-dialog'

interface AvailablePlansCardProps {
  topupInfo: MyWalletTopupInfo | null
  onPurchaseComplete?: () => void
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

function formatRelativeDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.floor(totalSeconds))
  if (total <= 0) return '00:00:00'
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const hh = String(hours).padStart(2, '0')
  const mm = String(minutes).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  if (days > 0) return `${days}d ${hh}:${mm}:${ss}`
  return `${hh}:${mm}:${ss}`
}

export function AvailablePlansCard(props: AvailablePlansCardProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  // The quota formatter reads this store; subscribe to currency display changes.
  useSystemConfigStore((state) => state.config.currency)
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanRecord | null>(null)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

  const hupijiaoEnabled = !!props.topupInfo?.enable_hupijiao_topup

  const fetchPlans = useCallback(async () => {
    const [planRes, subRes] = await Promise.all([
      getPublicPlans(),
      getSelfSubscriptionFull(),
    ])
    if (planRes.success) setPlans(planRes.data || [])
    if (subRes.success && subRes.data) {
      setAllSubscriptions(subRes.data.all_subscriptions || [])
    }
  }, [])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        await fetchPlans()
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [fetchPlans])

  const hasTimedPlan = useMemo(
    () =>
      plans.some(
        (p) =>
          Number(p.plan?.starts_at || 0) > 0 ||
          Number(p.plan?.expires_at || 0) > 0
      ),
    [plans]
  )

  useEffect(() => {
    if (!hasTimedPlan) return
    const id = window.setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      1000
    )
    return () => window.clearInterval(id)
  }, [hasTimedPlan])

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchPlans()
    } finally {
      setRefreshing(false)
    }
  }

  const planPurchaseCountMap = useMemo(() => {
    const map = new Map<number, number>()
    for (const sub of allSubscriptions) {
      const planId = sub?.subscription?.plan_id
      if (!planId) continue
      map.set(planId, (map.get(planId) || 0) + 1)
    }
    return map
  }, [allSubscriptions])

  if (loading) {
    return (
      <TitledCard
        title={t('Subscription Plans')}
        icon={<Crown className='h-4 w-4' aria-hidden='true' />}
        contentClassName='@container'
      >
        <div className='grid grid-cols-1 gap-4 @min-[36rem]:grid-cols-2 @min-[56rem]:grid-cols-3'>
          {['first', 'second', 'third'].map((key) => (
            <Skeleton key={key} className='h-80 w-full rounded-xl' />
          ))}
        </div>
      </TitledCard>
    )
  }

  if (plans.length === 0) {
    return (
      <TitledCard
        title={t('Subscription Plans')}
        icon={<Crown className='h-4 w-4' aria-hidden='true' />}
      >
        <p className='text-muted-foreground py-6 text-center text-sm'>
          {t('No plans available')}
        </p>
      </TitledCard>
    )
  }

  return (
    <>
      <TitledCard
        title={t('Subscription Plans')}
        description={t('Subscribe to a plan for model access')}
        icon={<Crown className='h-4 w-4' aria-hidden='true' />}
        action={
          <Button
            variant='ghost'
            size='icon'
            className='h-8 w-8'
            aria-label={t('Refresh')}
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn('h-4 w-4', refreshing && 'animate-spin')}
              aria-hidden='true'
            />
          </Button>
        }
        disableHoverEffect
        contentClassName='@container bg-muted/15'
      >
        <div
          data-slot='subscription-plan-grid'
          className='grid grid-cols-1 items-stretch gap-4 @min-[36rem]:grid-cols-2 @min-[56rem]:grid-cols-3'
        >
          {plans.map((p, index) => {
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

            const isPopular = index === 0 && plans.length > 1
            const limit = Number(plan.max_purchase_per_user || 0)
            const count = planPurchaseCountMap.get(plan.id) || 0
            const reached = limit > 0 && count >= limit
            const soldCount = Number(p.sold_count || 0)
            const resetPeriod = formatResetPeriod(plan, t)

            const sale = computeSaleWindow(plan, nowSec)
            const isSaleable =
              sale.status !== 'upcoming' && sale.status !== 'ended'
            const purchasable = isSaleable && !reached && hupijiaoEnabled
            const isRecommended = isPopular && purchasable

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
              { label: t('Validity Period'), value: duration },
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

            // Footer hint (only for live/ended; upcoming countdown lives on the button)
            let footerHint: string | null = null
            if (sale.status === 'ended') {
              footerHint = `${t('Sale ended at')} ${formatTimestamp(sale.expiresAt)}`
            } else if (sale.status === 'live' && sale.expiresAt > 0) {
              footerHint = `${t('Ends in')} ${formatRelativeDuration(sale.endsIn)}`
            }

            let buttonLabel = t('Subscribe Now')
            if (reached) {
              buttonLabel = t('Limit Reached')
            } else if (sale.status === 'upcoming') {
              buttonLabel = `${t('Starts in')} ${formatRelativeDuration(sale.startsIn)}`
            } else if (sale.status === 'ended') {
              buttonLabel = t('Sale Ended')
            }

            return (
              <Card
                key={plan.id}
                role='article'
                aria-labelledby={`subscription-plan-${plan.id}`}
                data-card-hover='false'
                className={cn(
                  'relative min-w-0 gap-0 rounded-xl border py-0 shadow-sm ring-0 transition-[border-color,box-shadow] duration-200',
                  isRecommended
                    ? 'border-primary/30 from-primary/5 to-card bg-gradient-to-b before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-primary'
                    : 'border-border/80 hover:border-foreground/20 hover:shadow-md'
                )}
              >
                <CardContent className='flex h-full min-w-0 flex-col p-4 sm:p-5'>
                  <div className='flex min-h-14 items-start justify-between gap-3'>
                    <div className='flex min-w-0 flex-1 items-start gap-2.5'>
                      <span
                        data-slot='plan-provider-icon'
                        aria-hidden='true'
                        className={cn(
                          'mt-0.5 flex size-8 shrink-0 items-center justify-center',
                          isRecommended ? 'text-primary' : 'text-foreground/80'
                        )}
                      >
                        {getLobeIcon('OpenAI', 32)}
                      </span>
                      <div className='min-w-0'>
                        <h3
                          id={`subscription-plan-${plan.id}`}
                          title={plan.title || t('Subscription Plans')}
                          className='truncate text-lg font-semibold tracking-tight'
                        >
                          {plan.title || t('Subscription Plans')}
                        </h3>
                        {plan.subtitle && (
                          <p
                            title={plan.subtitle}
                            className='text-muted-foreground mt-1 line-clamp-2 text-xs leading-relaxed break-words'
                          >
                            {plan.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className='max-w-[45%] min-w-0 shrink-0 text-right'>
                      <p className='text-xl leading-snug font-semibold tracking-tight break-all tabular-nums'>
                        {priceLabel}
                      </p>
                      <p className='text-muted-foreground mt-1 text-xs whitespace-nowrap'>
                        / {duration}
                      </p>
                    </div>
                  </div>

                  <div className='mt-4'>
                    <div className='flex min-h-5 flex-wrap items-center justify-between gap-2'>
                      <p className='text-muted-foreground text-xs'>
                        {t('Available Quota')}
                      </p>
                      {isRecommended && (
                        <StatusBadge
                          label={t('Recommended')}
                          variant='info'
                          copyable={false}
                          className='bg-primary text-primary-foreground rounded-md px-2 text-xs'
                        />
                      )}
                    </div>
                    <p className='mt-1.5 text-4xl leading-tight font-semibold tracking-tight break-all tabular-nums'>
                      {quotaLabel}
                    </p>
                    {soldCount > 0 && (
                      <p className='text-muted-foreground mt-1 text-xs'>
                        {t('Sold {{count}}', {
                          count: formatNumber(soldCount, locale),
                        })}
                      </p>
                    )}
                  </div>

                  <dl className='mt-4 divide-y border-t'>
                    {details.map((detail) => (
                      <div
                        key={detail.label}
                        className='flex items-start justify-between gap-3 py-2.5 text-xs'
                      >
                        <dt className='text-muted-foreground min-w-0 break-words'>
                          {detail.label}
                        </dt>
                        <dd className='max-w-[65%] text-right font-medium break-words'>
                          {detail.value}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className='mt-auto pt-4'>
                    {!hupijiaoEnabled && isSaleable && !reached ? (
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
                          {t(
                            'Contact the administrator to re-enable online payment.'
                          )}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Button
                        variant={isRecommended ? 'default' : 'outline'}
                        className={cn(
                          'h-auto min-h-11 w-full justify-between gap-3 px-3 py-2 text-sm font-medium whitespace-normal',
                          sale.status === 'upcoming' && 'tabular-nums'
                        )}
                        disabled={!purchasable}
                        onClick={() => {
                          setSelectedPlan(p)
                          setPurchaseOpen(true)
                        }}
                      >
                        <span className='min-w-0 flex-1'>{buttonLabel}</span>
                        {purchasable && (
                          <ArrowRight className='size-4' aria-hidden='true' />
                        )}
                      </Button>
                    )}

                    {footerHint ? (
                      <p className='text-muted-foreground mt-1.5 text-center text-xs tabular-nums'>
                        {footerHint}
                      </p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </TitledCard>

      <LocalSubscriptionPurchaseDialog
        open={purchaseOpen}
        onOpenChange={(open) => {
          setPurchaseOpen(open)
          if (!open) {
            void fetchPlans()
            props.onPurchaseComplete?.()
          }
        }}
        plan={selectedPlan}
        enableHupijiao={hupijiaoEnabled}
        purchaseLimit={
          selectedPlan?.plan?.max_purchase_per_user
            ? Number(selectedPlan.plan.max_purchase_per_user)
            : undefined
        }
        purchaseCount={
          selectedPlan?.plan?.id
            ? planPurchaseCountMap.get(selectedPlan.plan.id)
            : undefined
        }
      />
    </>
  )
}
