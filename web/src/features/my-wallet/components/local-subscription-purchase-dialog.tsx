// Local fork subscription purchase dialog. Independent of new-api's upstream
// SubscriptionPurchaseDialog — only the Hupijiao (Alipay) payment flow is
// supported here. Do NOT delegate to upstream dialog; upstream has hardcoded
// balance-payment UI we don't want.

import { useState } from 'react'
import { Crown, CalendarClock, Package } from 'lucide-react'
import { SiAlipay } from 'react-icons/si'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { GroupBadge } from '@/components/group-badge'
import { HupijiaoPaymentDialog } from '@/components/payment/hupijiao-payment-dialog'
import { formatCnyCurrencyAmount } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { paySubscriptionHupijiao } from '@/features/subscriptions/api'
import {
  formatDuration,
  formatResetPeriod,
} from '@/features/subscriptions/lib'
import type { PlanRecord } from '@/features/subscriptions/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: PlanRecord | null
  enableHupijiao?: boolean
  hupijiaoPaymentMethodName?: string
  purchaseLimit?: number
  purchaseCount?: number
}

export function LocalSubscriptionPurchaseDialog({
  open,
  onOpenChange,
  plan: planRecord,
  enableHupijiao,
  hupijiaoPaymentMethodName,
  purchaseLimit,
  purchaseCount,
}: Props) {
  const { t } = useTranslation()
  const [paying, setPaying] = useState(false)
  const [hupijiaoPaymentOpen, setHupijiaoPaymentOpen] = useState(false)
  const [hupijiaoPayment, setHupijiaoPayment] = useState<{
    order_id?: string
    qrcode_url?: string
    pay_url?: string
    trade_no?: string
    create_time?: number
  } | null>(null)

  const plan = planRecord?.plan
  if (!plan) return null

  const priceCNY = Number(plan.price_cny || 0)
  const totalAmount = Number(plan.total_amount || 0)
  const hasHupijiao = !!enableHupijiao && priceCNY > 0
  const limitReached =
    (purchaseLimit || 0) > 0 && (purchaseCount || 0) >= (purchaseLimit || 0)

  const displayPriceCNY = formatCnyCurrencyAmount(priceCNY, {
    digitsLarge: 2,
    digitsSmall: 2,
    abbreviate: false,
  })

  const handlePayHupijiao = async () => {
    setPaying(true)
    try {
      const res = await paySubscriptionHupijiao({ plan_id: plan.id })
      if (res.success && res.data?.pay_url) {
        setHupijiaoPayment({
          order_id: res.data.order_id,
          qrcode_url: res.data.qrcode_url,
          pay_url: res.data.pay_url,
          trade_no: res.data.trade_no,
          create_time: Math.floor(Date.now() / 1000),
        })
        setHupijiaoPaymentOpen(true)
        toast.success(t('Payment initiated'))
      } else {
        toast.error(
          res.message && res.message !== 'success'
            ? res.message
            : t('Payment request failed')
        )
      }
    } catch {
      toast.error(t('Payment request failed'))
    } finally {
      setPaying(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'>
          <DialogHeader>
            <DialogTitle className='flex items-center gap-2'>
              <Crown className='h-5 w-5' />
              {t('Purchase Subscription')}
            </DialogTitle>
          </DialogHeader>

          <div className='space-y-3 sm:space-y-4'>
            <div className='bg-muted/50 space-y-2.5 rounded-lg border p-3 sm:space-y-3 sm:p-4'>
              <div className='flex justify-between'>
                <span className='text-muted-foreground text-sm'>
                  {t('Plan Name')}
                </span>
                <span className='max-w-[200px] truncate text-sm font-medium'>
                  {plan.title}
                </span>
              </div>
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  {t('Validity Period')}
                </span>
                <span className='flex items-center gap-1 text-sm'>
                  <CalendarClock className='h-3.5 w-3.5' />
                  {formatDuration(plan, t)}
                </span>
              </div>
              {formatResetPeriod(plan, t) !== t('No Reset') && (
                <div className='flex justify-between'>
                  <span className='text-muted-foreground text-sm'>
                    {t('Reset Period')}
                  </span>
                  <span className='text-sm'>{formatResetPeriod(plan, t)}</span>
                </div>
              )}
              <div className='flex items-center justify-between'>
                <span className='text-muted-foreground text-sm'>
                  {t('Received amount')}
                </span>
                <span className='flex items-center gap-1 text-sm'>
                  <Package className='h-3.5 w-3.5' />
                  {totalAmount > 0 ? formatQuota(totalAmount) : t('Unlimited')}
                </span>
              </div>
              {plan.upgrade_group && (
                <div className='flex items-center justify-between'>
                  <span className='text-muted-foreground text-sm'>
                    {t('Upgrade Group')}
                  </span>
                  <GroupBadge group={plan.upgrade_group} />
                </div>
              )}
              <Separator />
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium'>{t('Amount Due')}</span>
                <span className='text-primary text-lg font-bold'>
                  {displayPriceCNY}
                </span>
              </div>
            </div>

            {limitReached && (
              <Alert variant='destructive'>
                <AlertDescription>
                  {t('Purchase limit reached')} ({purchaseCount}/{purchaseLimit}
                  )
                </AlertDescription>
              </Alert>
            )}

            {hasHupijiao ? (
              <Button
                variant='outline'
                className='w-full gap-2'
                onClick={handlePayHupijiao}
                disabled={paying || limitReached}
              >
                <SiAlipay className='h-4 w-4' style={{ color: '#1677FF' }} />
                {hupijiaoPaymentMethodName || t('Alipay')}
              </Button>
            ) : (
              <Alert>
                <AlertDescription>
                  {t(
                    'Online payment is not enabled. Please contact the administrator.'
                  )}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <HupijiaoPaymentDialog
        open={hupijiaoPaymentOpen}
        onOpenChange={(o) => {
          setHupijiaoPaymentOpen(o)
          if (!o) {
            onOpenChange(false)
          }
        }}
        payment={hupijiaoPayment}
        amount={priceCNY}
        onExpired={() => {
          setHupijiaoPaymentOpen(false)
          setHupijiaoPayment(null)
          toast.error('订单已过期，请重新下单')
        }}
      />
    </>
  )
}
