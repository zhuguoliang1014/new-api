import type { PlanSavings } from '../lib/subscription-savings'
import type { MyWalletTopupInfo } from '../types'
import { AvailablePlansCard } from './available-plans-card'

interface SubscriptionTabProps {
  topupInfo: MyWalletTopupInfo | null
  planSavings?: Map<number, PlanSavings>
  comparisonGroup?: string
  onPurchaseComplete?: () => void
}

export function SubscriptionTab(props: SubscriptionTabProps) {
  return (
    <div
      data-slot='subscription-layout'
      className='flex min-w-0 flex-col gap-4'
    >
      <AvailablePlansCard
        topupInfo={props.topupInfo}
        planSavings={props.planSavings}
        comparisonGroup={props.comparisonGroup}
        onPurchaseComplete={props.onPurchaseComplete}
      />
    </div>
  )
}
