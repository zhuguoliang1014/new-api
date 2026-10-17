import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getPublicPlans } from '@/features/subscriptions/api'
import { getUserGroups } from '@/lib/api'

import {
  computeSavingsByPlan,
  filterGPTGroups,
  type PlanSavings,
  type RechargePricing,
} from '../lib/subscription-savings'

export function useSubscriptionSavings(
  rechargePricing: RechargePricing | null
) {
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
  const result = useMemo(() => {
    if (!plans || !rechargePricing || comparisonRatio <= 0) {
      return { byPlan: new Map<number, PlanSavings>(), maxSavings: 0 }
    }
    const byPlan = computeSavingsByPlan(plans, comparisonRatio, rechargePricing)
    let maxSavings = 0
    for (const item of byPlan.values()) {
      maxSavings = Math.max(maxSavings, item.savings)
    }
    return { byPlan, maxSavings }
  }, [plans, comparisonRatio, rechargePricing])

  return { ...result, comparisonGroup: gptGroups[0]?.name }
}
