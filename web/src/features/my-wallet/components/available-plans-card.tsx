import { Crown, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
} from '@/features/subscriptions/api'
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import { cn } from '@/lib/utils'

import type { PlanSavings } from '../lib/subscription-savings'
import type { MyWalletTopupInfo } from '../types'
import { LocalSubscriptionPurchaseDialog } from './local-subscription-purchase-dialog'
import { SubscriptionPlanCard } from './subscription-plan-card'

interface AvailablePlansCardProps {
  topupInfo: MyWalletTopupInfo | null
  planSavings?: Map<number, PlanSavings>
  comparisonGroup?: string
  onPurchaseComplete?: () => void
}

export function AvailablePlansCard(props: AvailablePlansCardProps) {
  const { t } = useTranslation()
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
  const epayEnabled =
    !!props.topupInfo?.enable_online_topup &&
    !!props.topupInfo.pay_methods?.some((method) => method.type === 'alipay')
  const onlinePaymentEnabled = epayEnabled || hupijiaoEnabled

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
          Number(p.plan?.expires_at || 0) > 0 ||
          Number(p.plan?.discount_ends_at || 0) > 0
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
      >
        <div className='grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {['first', 'second', 'third'].map((key) => (
            <Skeleton key={key} className='h-72 w-full rounded-xl' />
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
        className='overflow-visible rounded-none border-0 bg-transparent shadow-none ring-0'
        titleClassName='text-base sm:text-lg'
        headerClassName='border-0 px-0 pt-0 pb-3! sm:px-0 sm:pt-0 sm:pb-3! [&>div]:flex-row [&>div>div:last-child]:w-auto'
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
        contentClassName='p-0 sm:p-0'
      >
        <div
          data-slot='subscription-plan-grid'
          className='grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3'
        >
          {plans.map((record, index) => (
            <SubscriptionPlanCard
              key={record.plan.id}
              record={record}
              now={nowSec}
              recommended={index === 0 && plans.length > 1}
              purchaseCount={planPurchaseCountMap.get(record.plan.id) || 0}
              paymentEnabled={onlinePaymentEnabled}
              savings={props.planSavings?.get(record.plan.id)}
              comparisonGroup={props.comparisonGroup}
              onPurchase={(plan) => {
                setSelectedPlan(plan)
                setPurchaseOpen(true)
              }}
            />
          ))}
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
        enableEpay={epayEnabled}
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
