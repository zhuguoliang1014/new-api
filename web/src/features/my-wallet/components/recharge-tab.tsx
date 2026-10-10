import { Gift, Loader2, WalletCards } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import { getDiscountLabel, getPaymentIcon } from '@/features/wallet/lib'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { PresetAmount } from '../types'

interface RechargeTabProps {
  hupijiaoEnabled: boolean
  presetAmounts: PresetAmount[]
  selectedPreset: number | null
  onSelectPreset: (preset: PresetAmount) => void
  topupAmount: number
  onTopupAmountChange: (amount: number) => void
  paymentAmount: number
  calculating: boolean
  minTopup: number
  priceRatio: number
  paymentLoading: string | null
  onAlipayClick: () => void
  redemptionCode: string
  onRedemptionCodeChange: (code: string) => void
  onRedeem: () => void
  redeeming: boolean
  redemptionEnabled: boolean
  loading?: boolean
}

function formatUsd(value: number): string {
  return `$${formatNumber(value)}`
}

function formatCny(value: number): string {
  if (!Number.isFinite(value)) return '-'
  const fractionDigits = Math.abs(value) >= 1 ? 2 : 4
  return `¥${value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  })}`
}

export function RechargeTab({
  hupijiaoEnabled,
  presetAmounts,
  selectedPreset,
  onSelectPreset,
  topupAmount,
  onTopupAmountChange,
  paymentAmount,
  calculating,
  minTopup,
  priceRatio,
  paymentLoading,
  onAlipayClick,
  redemptionCode,
  onRedemptionCodeChange,
  onRedeem,
  redeeming,
  redemptionEnabled,
  loading,
}: RechargeTabProps) {
  const { t } = useTranslation()
  const [localAmount, setLocalAmount] = useState(topupAmount.toString())

  useEffect(() => {
    setLocalAmount(topupAmount.toString())
  }, [topupAmount])

  const handleAmountChange = (value: string) => {
    setLocalAmount(value)
    const numValue = Number.parseInt(value) || 0
    if (numValue >= 0) onTopupAmountChange(numValue)
  }

  const showPresets = hupijiaoEnabled && presetAmounts.length > 0
  const belowMin = hupijiaoEnabled && topupAmount > 0 && topupAmount < minTopup

  return (
    <div id='wallet-add-funds' className='scroll-mt-4'>
      <TitledCard
        title={t('Add Funds')}
        description={t('Pay in CNY (¥), receive USD ($) credit')}
        icon={<WalletCards className='h-4 w-4' aria-hidden='true' />}
        disableHoverEffect
        contentClassName='space-y-5 sm:space-y-6'
      >
        <section
          aria-label={t('Redemption Code')}
          className='bg-muted/30 rounded-xl border p-3 sm:p-4'
        >
          {redemptionEnabled ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                if (!redeeming && redemptionCode.trim()) onRedeem()
              }}
              className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-6'
            >
              <div className='flex items-center gap-3'>
                <Gift
                  className='text-muted-foreground size-5 shrink-0'
                  aria-hidden='true'
                />
                <div>
                  <Label
                    htmlFor='redemption-code'
                    className='text-sm font-medium'
                  >
                    {t('Redemption Code')}
                  </Label>
                  <p className='text-muted-foreground mt-1 text-xs'>
                    {t('Have a code? Redeem it for credit')}
                  </p>
                </div>
              </div>
              <div className='flex min-w-0 gap-2 md:w-1/2'>
                <Input
                  id='redemption-code'
                  value={redemptionCode}
                  onChange={(event) =>
                    onRedemptionCodeChange(event.target.value)
                  }
                  placeholder={t('Enter your redemption code')}
                  disabled={redeeming}
                  className='bg-background h-11 min-w-0 flex-1'
                />
                <Button
                  type='submit'
                  disabled={redeeming || !redemptionCode.trim()}
                  variant='outline'
                  className='h-11 px-4'
                >
                  {redeeming && (
                    <Loader2
                      className='size-4 animate-spin'
                      aria-hidden='true'
                    />
                  )}
                  {t('Redeem')}
                </Button>
              </div>
            </form>
          ) : (
            <Alert>
              <AlertDescription>
                {t(
                  'Redemption codes are disabled until the administrator confirms compliance terms.'
                )}
              </AlertDescription>
            </Alert>
          )}
        </section>
        <div className='space-y-5 sm:space-y-6'>
          {loading && <RechargeSkeleton />}
          {!loading && !hupijiaoEnabled && (
            <Alert>
              <AlertDescription>
                {t(
                  'Online topup is not enabled. Please use redemption code or contact administrator.'
                )}
              </AlertDescription>
            </Alert>
          )}
          {!loading && hupijiaoEnabled && (
            <>
              {showPresets ? (
                <div className='space-y-2.5 sm:space-y-3'>
                  <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                    {t('Amount')}
                  </Label>
                  <div className='grid grid-cols-2 gap-1.5 sm:gap-3 md:grid-cols-3'>
                    {presetAmounts.map((preset) => {
                      const discount = preset.discount || 1
                      const hasDiscount = discount < 1
                      const actualPrice = preset.value * priceRatio * discount
                      const original = preset.value * priceRatio
                      const saved = original - actualPrice
                      const isSelected = selectedPreset === preset.value
                      return (
                        <Button
                          key={preset.value}
                          variant='outline'
                          className={cn(
                            'hover:border-primary/50 flex min-h-20 flex-col items-start rounded-lg px-3 py-2.5 text-left whitespace-normal sm:min-h-[72px] sm:p-4',
                            isSelected
                              ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                              : 'border-muted'
                          )}
                          aria-pressed={isSelected}
                          onClick={() => onSelectPreset(preset)}
                        >
                          <div className='flex w-full items-center justify-between'>
                            <div className='text-base font-semibold sm:text-lg'>
                              {formatUsd(preset.value)}
                            </div>
                            {hasDiscount ? (
                              <div className='text-xs font-medium text-green-600'>
                                {getDiscountLabel(discount)}
                              </div>
                            ) : null}
                          </div>
                          <div className='text-muted-foreground mt-1.5 w-full text-xs sm:mt-2'>
                            {t('Pay {{amount}}', {
                              amount: formatCny(actualPrice),
                            })}
                            {hasDiscount && saved > 0 ? (
                              <span className='text-green-600'>
                                {' '}
                                ·{' '}
                                {t('Save {{amount}}', {
                                  amount: formatCny(saved),
                                })}
                              </span>
                            ) : null}
                          </div>
                        </Button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <div className='space-y-2.5 sm:space-y-3'>
                <Label
                  htmlFor='topup-amount'
                  className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
                >
                  {t('Custom Amount (USD)')}
                </Label>
                <div className='grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.6fr)] sm:items-center'>
                  <div className='relative'>
                    <span className='text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-base font-medium sm:text-lg'>
                      $
                    </span>
                    <Input
                      id='topup-amount'
                      type='number'
                      value={localAmount}
                      onChange={(e) => handleAmountChange(e.target.value)}
                      min={minTopup}
                      placeholder={String(minTopup)}
                      className='h-11 pl-7 text-base'
                    />
                  </div>
                  <div className='bg-muted/30 flex min-h-11 items-center justify-between gap-2 rounded-md border px-3'>
                    <span className='text-muted-foreground truncate text-xs'>
                      {t('Amount to pay:')}
                    </span>
                    {calculating ? (
                      <Skeleton className='h-5 w-16' />
                    ) : (
                      <span className='text-sm font-semibold'>
                        {formatCny(paymentAmount)}
                      </span>
                    )}
                  </div>
                </div>
                {belowMin ? (
                  <p className='text-destructive text-xs'>
                    {t('Minimum topup amount: {{amount}}', {
                      amount: formatUsd(minTopup),
                    })}
                  </p>
                ) : null}
              </div>

              <div className='space-y-2.5 sm:space-y-3'>
                <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
                  {t('Payment Method')}
                </Label>
                <Button
                  onClick={onAlipayClick}
                  disabled={belowMin || !!paymentLoading || topupAmount <= 0}
                  className='h-11 w-full justify-center gap-2 rounded-lg sm:w-auto sm:min-w-48 sm:px-6'
                >
                  {paymentLoading === 'alipay' ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    getPaymentIcon('alipay', 'h-4 w-4')
                  )}
                  <span>{t('Alipay')}</span>
                </Button>
              </div>
            </>
          )}
        </div>
      </TitledCard>
    </div>
  )
}

function RechargeSkeleton() {
  return (
    <div className='space-y-4 sm:space-y-6'>
      <div className='space-y-3'>
        <Skeleton className='h-3 w-16' />
        <div className='grid grid-cols-2 gap-3 sm:grid-cols-3'>
          {['one', 'two', 'three', 'four', 'five', 'six'].map((key) => (
            <Skeleton key={key} className='h-[72px] rounded-lg' />
          ))}
        </div>
      </div>
      <div className='space-y-3'>
        <Skeleton className='h-3 w-28' />
        <Skeleton className='h-10 w-full' />
      </div>
      <div className='space-y-3'>
        <Skeleton className='h-3 w-32' />
        <Skeleton className='h-10 w-40 rounded-lg' />
      </div>
    </div>
  )
}
