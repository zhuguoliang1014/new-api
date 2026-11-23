import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getPublicPlans } from '@/features/subscriptions/api'
import { DEFAULT_SUBSCRIPTION_GROUP } from '@/features/subscriptions/constants'
import { usePromotionClock } from '@/features/subscriptions/hooks/use-promotion-clock'
import { useTopupInfoQuery } from '@/features/wallet/hooks/use-topup-info-query'
import { getUserGroups } from '@/lib/api'
import { statusQueryOptions } from '@/lib/status-query'

import {
  computePlanSavings,
  filterSubscriptionGroups,
  type PlanSavings,
  type RechargePricing,
} from '../lib/subscription-savings'
import type { MyWalletTopupInfo } from '../types'

export function useSubscriptionSavings(
  rechargePricing?: RechargePricing | null
) {
  const topupQuery = useTopupInfoQuery(rechargePricing === undefined)
  const statusQuery = useQuery({
    ...statusQueryOptions,
    enabled: rechargePricing === undefined,
  })
  const topup = topupQuery.data?.data as MyWalletTopupInfo | undefined
  const nativeEnabled =
    !!topup?.enable_online_topup &&
    !!topup.pay_methods?.some((method) => method.type === 'alipay')
  const unitPrice = nativeEnabled
    ? Number(statusQuery.data?.price ?? 0)
    : Number(topup?.hupijiao_price ?? 0)
  const sharedPricing = useMemo(() => {
    if (rechargePricing !== undefined) return rechargePricing
    if (
      (!nativeEnabled && !topup?.enable_hupijiao_topup) ||
      !Number.isFinite(unitPrice) ||
      unitPrice <= 0
    ) {
      return null
    }
    return { unitPrice }
  }, [rechargePricing, nativeEnabled, topup?.enable_hupijiao_topup, unitPrice])
  const plansQuery = useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: getPublicPlans,
    staleTime: 5 * 60 * 1000,
  })

  const groupsQuery = useQuery({
    queryKey: ['user', 'groups'],
    queryFn: getUserGroups,
    staleTime: 5 * 60 * 1000,
  })

  const plans = plansQuery.data?.data
  const promotionNow = usePromotionClock(
    !!plans?.some((record) => record.plan.discount_ends_at)
  )
  const result = useMemo(() => {
    const byPlan = new Map<number, PlanSavings>()
    let maxSavings = 0
    let comparisonGroup: string | undefined
    if (!plans || !sharedPricing || !groupsQuery.data?.success) {
      return { byPlan, maxSavings, comparisonGroup }
    }
    for (const record of plans) {
      if (!record.plan.enabled) continue
      const group = filterSubscriptionGroups(
        groupsQuery.data.data,
        record.plan.allowed_groups ?? [DEFAULT_SUBSCRIPTION_GROUP]
      )[0]
      if (!group) continue
      const savings = computePlanSavings(
        record,
        group.ratio,
        sharedPricing,
        promotionNow
      )
      if (!savings) continue
      byPlan.set(record.plan.id, { ...savings, comparisonGroup: group.name })
      if (savings.savings > maxSavings) {
        maxSavings = savings.savings
        comparisonGroup = group.name
      }
    }
    return { byPlan, maxSavings, comparisonGroup }
  }, [plans, groupsQuery.data, sharedPricing, promotionNow])

  return result
}
