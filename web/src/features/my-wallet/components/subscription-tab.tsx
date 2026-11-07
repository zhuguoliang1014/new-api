import { InfoIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'

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
  const { t } = useTranslation()
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
      <Alert
        role='note'
        className='text-muted-foreground border-border/60 bg-muted/30 flex items-center gap-2 px-3 py-2 [&>svg]:row-auto [&>svg]:translate-y-0'
      >
        <InfoIcon className='size-4 shrink-0' aria-hidden='true' />
        <AlertDescription className='text-xs leading-5'>
          {t('GPT subscriptions only support GPT models.')}
        </AlertDescription>
      </Alert>

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
