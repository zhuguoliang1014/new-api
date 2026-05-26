import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { BillingHistoryList } from './components/billing-history-list'

export function AdminOrders() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Order History')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='bg-background rounded-lg border p-4'>
          <BillingHistoryList scrollAreaClassName='h-[calc(100vh-250px)] min-h-[420px] pr-4' />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
