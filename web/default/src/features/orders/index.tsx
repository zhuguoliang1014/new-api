import { SectionPageLayout } from '@/components/layout'
import { BillingHistoryList } from './components/billing-history-list'

export function Orders() {
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>我的订单</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='bg-background rounded-lg border p-4'>
          <BillingHistoryList
            scrollAreaClassName='h-[calc(100vh-250px)] min-h-[420px] pr-4'
            userOnly
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
