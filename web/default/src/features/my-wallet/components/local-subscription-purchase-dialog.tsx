// Local fork wrapper around SubscriptionPurchaseDialog.
// Adds the Hupijiao (Alipay) payment flow on top of the upstream dialog by
// passing render-prop slots (extraPaymentMethods, priceDisplayOverride). All
// Hupijiao state, handlers, and the QR-code dialog live here; the upstream
// dialog stays free of fork-specific code.

import { useState, type ComponentProps } from 'react'
import { SiAlipay } from 'react-icons/si'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { HupijiaoPaymentDialog } from '@/components/payment/hupijiao-payment-dialog'
import { formatCnyCurrencyAmount } from '@/lib/currency'
import { paySubscriptionHupijiao } from '@/features/subscriptions/api'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'

type BaseProps = ComponentProps<typeof SubscriptionPurchaseDialog>

interface Props extends BaseProps {
  enableHupijiao?: boolean
  hupijiaoPaymentMethodName?: string
}

export function LocalSubscriptionPurchaseDialog({
  enableHupijiao,
  hupijiaoPaymentMethodName,
  ...rest
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

  const plan = rest.plan?.plan
  const priceCNY = Number(plan?.price_cny || 0)
  const hasHupijiao = !!enableHupijiao && priceCNY > 0

  // Mirror the upstream dialog's "any non-Hupijiao payment available" check
  // so we know whether to show the hybrid CNY/USD label.
  const hasNonHupijiaoPayment =
    !!(rest.enableStripe && plan?.stripe_price_id) ||
    !!(rest.enableCreem && plan?.creem_product_id) ||
    !!(rest.enableWaffoPancake && plan?.waffo_pancake_product_id) ||
    (!!rest.enableOnlineTopUp && (rest.epayMethods || []).length > 0)

  const handlePayHupijiao = async () => {
    if (!plan) return
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

  const limitReached =
    (rest.purchaseLimit || 0) > 0 &&
    (rest.purchaseCount || 0) >= (rest.purchaseLimit || 0)

  const extraPaymentMethods = hasHupijiao ? (
    <Button
      variant='outline'
      className='flex-1 gap-2'
      onClick={handlePayHupijiao}
      disabled={paying || limitReached}
    >
      <SiAlipay className='h-4 w-4' style={{ color: '#1677FF' }} />
      {hupijiaoPaymentMethodName || t('Alipay')}
    </Button>
  ) : null

  let priceDisplayOverride: string | null = null
  if (hasHupijiao) {
    const displayPriceCNY = formatCnyCurrencyAmount(priceCNY, {
      digitsLarge: 2,
      digitsSmall: 2,
      abbreviate: false,
    })
    const usd = Number(plan?.price_amount || 0).toFixed(2)
    priceDisplayOverride = hasNonHupijiaoPayment
      ? `支付宝 ${displayPriceCNY} / 其他 $${usd}`
      : displayPriceCNY
  }

  return (
    <>
      <SubscriptionPurchaseDialog
        {...rest}
        extraPaymentMethods={extraPaymentMethods}
        priceDisplayOverride={priceDisplayOverride}
        hasExtraPayment={hasHupijiao}
      />

      <HupijiaoPaymentDialog
        open={hupijiaoPaymentOpen}
        onOpenChange={(open) => {
          setHupijiaoPaymentOpen(open)
          if (!open) {
            rest.onOpenChange(false)
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
