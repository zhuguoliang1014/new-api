import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getPublicPlans } from '@/features/subscriptions/api'
import { usePromotionClock } from '@/features/subscriptions/hooks/use-promotion-clock'
import { useTopupInfoQuery } from '@/features/wallet/hooks/use-topup-info-query'
import { getUserGroups } from '@/lib/api'
import { statusQueryOptions } from '@/lib/status-query'

import {
  computeSavingsByPlan,
  filterGPTGroups,
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

  // `filterGPTGroups` sorts by ratio descending, so the first entry is the most
  // expensive GPT group the user can recharge into — the honest baseline to
  // compare a subscription against.
  const gptGroups = useMemo(() => {
    if (!groupsQuery.data?.success) return []
    return filterGPTGroups(groupsQuery.data.data)
  }, [groupsQuery.data])

  const comparisonRatio = gptGroups[0]?.ratio ?? 0

  const plans = plansQuery.data?.data
  const promotionNow = usePromotionClock(
    !!plans?.some((record) => record.plan.discount_ends_at)
  )
  const result = useMemo(() => {
    if (!plans || !sharedPricing || comparisonRatio <= 0) {
      return { byPlan: new Map<number, PlanSavings>(), maxSavings: 0 }
    }
    const byPlan = computeSavingsByPlan(
      plans,
      comparisonRatio,
      sharedPricing,
      promotionNow
    )
    let maxSavings = 0
    for (const item of byPlan.values()) {
      maxSavings = Math.max(maxSavings, item.savings)
    }
    return { byPlan, maxSavings }
  }, [plans, comparisonRatio, sharedPricing, promotionNow])

  return { ...result, comparisonGroup: gptGroups[0]?.name }
}
