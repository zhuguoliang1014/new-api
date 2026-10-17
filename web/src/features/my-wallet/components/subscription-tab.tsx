import { InfoIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

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
        className='border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
      >
        <InfoIcon aria-hidden='true' />
        <AlertTitle>
          {t('Wallet for all models, subscription for GPT')}
        </AlertTitle>
        <AlertDescription className='leading-relaxed text-amber-800 dark:text-amber-200'>
          {t(
            'Wallet balance can be used for any model. Subscription quota is for GPT models only and follows the plan’s expiry and reset rules.'
          )}
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
