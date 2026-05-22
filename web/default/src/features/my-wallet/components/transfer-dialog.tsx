import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getCurrencyDisplay } from '@/lib/currency'
import { formatQuota } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TransferDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (amountUsd: number) => Promise<boolean>
  availableQuota: number
  transferring: boolean
}

function formatUsdInput(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return ''
  return value.toFixed(2).replace(/\.?0+$/, '')
}

function quotaToUsdCents(quota: number, quotaPerUnit: number): number {
  if (quotaPerUnit <= 0) return 0
  return Math.floor((quota / quotaPerUnit) * 100) / 100
}

export function TransferDialog({
  open,
  onOpenChange,
  onConfirm,
  availableQuota,
  transferring,
}: TransferDialogProps) {
  const { t } = useTranslation()
  const { config } = getCurrencyDisplay()
  const availableAmountUsd = useMemo(
    () => quotaToUsdCents(availableQuota, config.quotaPerUnit),
    [availableQuota, config.quotaPerUnit]
  )
  const [amount, setAmount] = useState('')
  const amountValue = Number(amount)
  const canTransfer =
    Number.isFinite(amountValue) &&
    amountValue >= 0.01 &&
    amountValue <= availableAmountUsd

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmount(formatUsdInput(availableAmountUsd))
    }
  }, [availableAmountUsd, open])

  const handleConfirm = async () => {
    if (!canTransfer) return
    const success = await onConfirm(amountValue)
    if (success) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'>
        <DialogHeader>
          <DialogTitle className='text-xl font-semibold'>
            {t('Transfer Rewards')}
          </DialogTitle>
          <DialogDescription>
            {t('Move affiliate rewards to your main balance')}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-4 py-3 sm:space-y-6 sm:py-4'>
          <div className='space-y-2'>
            <Label className='text-muted-foreground text-xs font-medium tracking-wider uppercase'>
              {t('Available Rewards')}
            </Label>
            <div className='text-2xl font-semibold'>
              {formatQuota(availableQuota)}
            </div>
          </div>

          <div className='space-y-3'>
            <Label
              htmlFor='my-wallet-transfer-amount'
              className='text-muted-foreground text-xs font-medium tracking-wider uppercase'
            >
              {t('Transfer Amount (USD)')}
            </Label>
            <Input
              id='my-wallet-transfer-amount'
              type='number'
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={0.01}
              max={availableAmountUsd}
              step={0.01}
              className='font-mono text-lg'
            />
            <p className='text-muted-foreground text-xs'>
              {t('Minimum:')} $0.01
            </p>
          </div>
        </div>

        <DialogFooter className='grid grid-cols-2 gap-2 sm:flex'>
          <Button
            variant='outline'
            onClick={() => onOpenChange(false)}
            disabled={transferring}
          >
            {t('Cancel')}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={transferring || !canTransfer}
          >
            {transferring && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
            {t('Transfer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
