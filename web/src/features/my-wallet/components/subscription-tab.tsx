import { useCallback, useState } from 'react'

import type { MyWalletTopupInfo } from '../types'
import { AvailablePlansCard } from './available-plans-card'
import { MySubscriptionsCard } from './my-subscriptions-card'

interface SubscriptionTabProps {
  topupInfo: MyWalletTopupInfo | null
  onPurchaseComplete?: () => void
}

export function SubscriptionTab({
  topupInfo,
  onPurchaseComplete,
}: SubscriptionTabProps) {
  const [refreshSignal, setRefreshSignal] = useState(0)
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
        topupInfo={topupInfo}
        onPurchaseComplete={triggerRefresh}
      />
    </div>
  )
}
