import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Layers,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/status-badge'
import { useSubscriptionHistory } from '../hooks/use-subscription-history'

interface SubscriptionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SubscriptionHistoryDialog({
  open,
  onOpenChange,
}: SubscriptionHistoryDialogProps) {
  const { t } = useTranslation()
  const {
    records,
    total,
    page,
    pageSize,
    loading,
    handlePageChange,
    handlePageSizeChange,
  } = useSubscriptionHistory()

  const totalPages = Math.ceil(total / pageSize)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[calc(100dvh-2rem)] flex-col max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('Subscription History')}</DialogTitle>
          <DialogDescription>
            {t('View your expired and cancelled subscriptions')}
          </DialogDescription>
        </DialogHeader>

        <div className='min-h-0 flex-1 space-y-3 sm:space-y-4'>
          <div className='flex items-center justify-end'>
            <Select
              items={[
                { value: '10', label: t('10 / page') },
                { value: '20', label: t('20 / page') },
                { value: '50', label: t('50 / page') },
              ]}
              value={pageSize.toString()}
              onValueChange={(value) =>
                value !== null && handlePageSizeChange(parseInt(value))
              }
            >
              <SelectTrigger className='h-9 w-[92px] sm:w-32'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value='10'>{t('10 / page')}</SelectItem>
                  <SelectItem value='20'>{t('20 / page')}</SelectItem>
                  <SelectItem value='50'>{t('50 / page')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <ScrollArea className='h-[calc(100dvh-15rem)] pr-3 sm:h-[420px] sm:pr-4'>
            {loading ? (
              <div className='space-y-2'>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className='rounded-lg border border-dashed p-3'>
                    <Skeleton className='h-4 w-40' />
                    <Skeleton className='mt-2 h-3 w-32' />
                    <Skeleton className='mt-2.5 h-1.5 w-full' />
                  </div>
                ))}
              </div>
            ) : records.length === 0 ? (
              <div className='text-muted-foreground flex h-[320px] flex-col items-center justify-center text-center'>
                <p className='text-sm font-medium'>
                  {t('No subscription records')}
                </p>
              </div>
            ) : (
              <div className='space-y-2'>
                {records.map((record) => {
                  const subscription = record.subscription
                  const isCancelled = subscription.status === 'cancelled'
                  const totalAmount = Number(subscription.amount_total || 0)
                  const usedAmount = Number(subscription.amount_used || 0)
                  const usagePercent =
                    totalAmount > 0
                      ? Math.round((usedAmount / totalAmount) * 100)
                      : 0
                  const planTitle = record.plan_title || ''

                  return (
                    <div
                      key={subscription.id}
                      className='rounded-lg border border-dashed opacity-70'
                    >
                      <div className='min-w-0 px-3 py-2.5 sm:px-3.5 sm:py-3'>
                        <div className='flex flex-wrap items-center justify-between gap-2'>
                          <span className='truncate text-sm font-semibold'>
                            {planTitle || t('Subscription')}
                          </span>
                          {isCancelled ? (
                            <StatusBadge
                              label={t('Cancelled')}
                              variant='neutral'
                              copyable={false}
                            />
                          ) : (
                            <StatusBadge
                              label={t('Expired')}
                              variant='neutral'
                              copyable={false}
                            />
                          )}
                        </div>

                        <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
                          <span className='text-muted-foreground inline-flex items-center gap-1'>
                            <CalendarClock className='size-3.5' />
                            {isCancelled
                              ? t('Cancelled at')
                              : t('Expired at')}{' '}
                            <span className='text-foreground/80'>
                              {new Date(
                                subscription.end_time * 1000
                              ).toLocaleDateString()}
                            </span>
                          </span>
                        </div>

                        {totalAmount > 0 ? (
                          <div className='mt-2.5'>
                            <div className='text-muted-foreground/80 mb-1 flex items-center justify-between text-[11px]'>
                              <span className='inline-flex items-center gap-1'>
                                <CreditCard className='size-3' />
                                {formatQuota(usedAmount)} /{' '}
                                {formatQuota(totalAmount)}
                              </span>
                              <span className='tabular-nums'>
                                {usagePercent}%
                              </span>
                            </div>
                            <Progress value={usagePercent} className='h-1.5' />
                          </div>
                        ) : (
                          <div className='text-muted-foreground/70 mt-2 inline-flex items-center gap-1 text-xs'>
                            <Layers className='size-3' />
                            {t('Unlimited')}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </ScrollArea>

          {!loading && records.length > 0 && (
            <div className='flex flex-col items-center gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between'>
              <div className='text-muted-foreground text-xs sm:text-sm'>
                {t('Showing')} {(page - 1) * pageSize + 1}-
                {Math.min(page * pageSize, total)} {t('of')} {total}
              </div>
              <div className='flex items-center gap-2'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1}
                  className='h-8 w-8 p-0'
                >
                  <ChevronLeft className='h-4 w-4' />
                </Button>
                <div className='text-muted-foreground flex items-center gap-1 text-sm'>
                  <span className='font-medium'>{page}</span>
                  <span>/</span>
                  <span>{totalPages}</span>
                </div>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages}
                  className='h-8 w-8 p-0'
                >
                  <ChevronRight className='h-4 w-4' />
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
