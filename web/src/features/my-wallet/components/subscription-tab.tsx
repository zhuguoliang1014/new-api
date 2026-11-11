import { useCallback, useState } from 'react'

import type { PlanSavings } from '../lib/subscription-savings'
import type { MyWalletTopupInfo } from '../types'
import { AvailablePlansCard } from './available-plans-card'
import { MySubscriptionsCard } from './my-subscriptions-card'

interface SubscriptionTabProps {
  topupInfo: MyWalletTopupInfo | null
  planSavings?: Map<number, PlanSavings>
  comparisonGroup?: string
  onPurchaseComplete?: () => void
}

export function SubscriptionTab(props: SubscriptionTabProps) {
  const [refreshSignal, setRefreshSignal] = useState(0)
  const onPurchaseComplete = props.onPurchaseComplete
  const triggerRefresh = useCallback(() => {
    setRefreshSignal((n) => n + 1)
    onPurchaseComplete?.()
  }, [onPurchaseComplete])

  return (
    <div
      data-slot='subscription-layout'
      className='flex min-w-0 flex-col gap-4'
    >
      <MySubscriptionsCard refreshSignal={refreshSignal} />
      <AvailablePlansCard
        topupInfo={props.topupInfo}
        planSavings={props.planSavings}
        comparisonGroup={props.comparisonGroup}
        onPurchaseComplete={triggerRefresh}
      />
    </div>
  )
}
