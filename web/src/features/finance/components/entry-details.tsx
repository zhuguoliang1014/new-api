/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toIntlLocale } from '@/i18n/languages'

import {
  downloadFinanceFile,
  financeAction,
  getFinanceDetails,
  uploadFinanceReceipt,
} from '../api'
import { financeCents, financeKindLabel, financeMoney } from '../lib'

export function FinanceEntryDetails(props: {
  id: number
  canWrite: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['finance', 'entry', props.id],
    queryFn: () => getFinanceDetails(props.id),
  })
  const [fee, setFee] = useState(''),
    [amount, setAmount] = useState(''),
    [date, setDate] = useState(''),
    [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const reconcile = useMutation({
    mutationFn: () =>
      financeAction(`entries/${props.id}/reconcile`, {
        version: query.data?.entry.version,
        amount_cents: financeCents(
          amount || String((query.data?.entry.amount_cents ?? 0) / 100)
        ),
        fee_cents: financeCents(fee),
        date: date || query.data?.entry.date,
        reason,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['finance'] }),
  })
  const upload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error(t('Select a receipt image or PDF under 3 MB'))
      return uploadFinanceReceipt(props.id, file)
    },
    onSuccess: async () => {
      setFile(null)
      await client.invalidateQueries({
        queryKey: ['finance', 'entry', props.id],
      })
    },
  })
  const download = useMutation({
    mutationFn: (attachment: { id: number; name: string }) =>
      downloadFinanceFile(`attachments/${attachment.id}`, attachment.name),
  })
  const data = query.data
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Financial entry details')}
      contentClassName='sm:max-w-2xl'
    >
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {data && (
        <div className='flex flex-col gap-5'>
          <dl className='grid gap-3 sm:grid-cols-2'>
            {[
              [t('Type'), financeKindLabel(t, data.entry.kind)],
              [t('Accounting month'), data.entry.month],
              [t('Payment reference'), data.entry.source_ref || '—'],
              [
                t('Amount'),
                `${data.entry.currency} ${(data.entry.amount_cents / 100).toFixed(2)}`,
              ],
              [t('Payer'), data.entry.payer || '—'],
              [t('Notes'), data.entry.note || '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className='text-muted-foreground text-xs'>{label}</dt>
                <dd className='text-sm break-words'>{value}</dd>
              </div>
            ))}
          </dl>
          {data.entry.source === 'payment' && props.canWrite && (
            <form
              className='grid gap-3 rounded-lg border p-4 sm:grid-cols-2'
              onSubmit={(event) => {
                event.preventDefault()
                setError('')
                const cents = financeCents(fee)
                const paid = financeCents(
                  amount || String(data.entry.amount_cents / 100)
                )
                if (cents === null || paid === null || cents > paid) {
                  setError(t('Invalid payment fee'))
                  return
                }
                reconcile.mutate()
              }}
            >
              <h3 className='font-medium sm:col-span-2'>
                {t('Reconcile payment')}
              </h3>
              <div className='grid gap-2'>
                <Label htmlFor='reconcile-date'>
                  {t('Actual payment date')}
                </Label>
                <Input
                  id='reconcile-date'
                  type='date'
                  value={date || data.entry.date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='reconcile-fee'>
                  {t('Actual payment fee')} (CNY)
                </Label>
                <Input
                  id='reconcile-fee'
                  inputMode='decimal'
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  required
                  placeholder={((data.entry.fee_cents ?? 0) / 100).toFixed(2)}
                />
              </div>
              {data.entry.currency !== 'CNY' && (
                <div className='grid gap-2'>
                  <Label htmlFor='reconcile-amount'>
                    {t('Actual CNY amount')}
                  </Label>
                  <Input
                    id='reconcile-amount'
                    inputMode='decimal'
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className='grid gap-2 sm:col-span-2'>
                <Label htmlFor='reconcile-reason'>
                  {t('Statement reference and reason')}
                </Label>
                <Input
                  id='reconcile-reason'
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  required
                  maxLength={500}
                />
              </div>
              {error && (
                <p
                  role='alert'
                  className='text-destructive text-sm sm:col-span-2'
                >
                  {error}
                </p>
              )}
              <Button type='submit' disabled={reconcile.isPending}>
                {t('Confirm reconciliation')}
              </Button>
            </form>
          )}
          <section className='flex flex-col gap-3'>
            <h3 className='font-medium'>{t('Receipts')}</h3>
            {data.attachments.map((attachment) => (
              <Button
                className='justify-start'
                variant='outline'
                key={attachment.id}
                onClick={() => download.mutate(attachment)}
                disabled={download.isPending}
              >
                {attachment.name}
              </Button>
            ))}
            {props.canWrite && !data.entry.voided && (
              <>
                <Label htmlFor='finance-receipt'>
                  {t('Receipt image or PDF, up to 3 MB')}
                </Label>
                <Input
                  id='finance-receipt'
                  type='file'
                  accept='image/png,image/jpeg,image/webp,application/pdf'
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button
                  variant='outline'
                  onClick={() => upload.mutate()}
                  disabled={
                    !file || file.size > 3 * 1024 * 1024 || upload.isPending
                  }
                >
                  {t('Upload')}
                </Button>
              </>
            )}
          </section>
          <section className='flex flex-col gap-3'>
            <h3 className='font-medium'>{t('Change history')}</h3>
            {data.audits.map((audit) => {
              const before = JSON.parse(audit.before) as {
                amount_cents?: number
                fee_cents?: number
                month?: string
              } | null
              const after = JSON.parse(audit.after) as {
                amount_cents?: number
                fee_cents?: number
                month?: string
              } | null
              return (
                <div key={audit.id} className='border-t pt-3 text-sm'>
                  <p>
                    {new Date(audit.created_at * 1000).toLocaleString(locale, {
                      timeZone: 'Asia/Shanghai',
                    })}{' '}
                    · {t('User ID')} {audit.actor_id}
                  </p>
                  <p className='break-words'>{audit.reason || audit.action}</p>
                  {after?.amount_cents !== undefined && (
                    <p className='text-muted-foreground'>
                      {t('Amount')}:{' '}
                      {before?.amount_cents === undefined
                        ? '—'
                        : financeMoney(before.amount_cents, locale)}{' '}
                      → {financeMoney(after.amount_cents, locale)} ·{' '}
                      {after.month}
                    </p>
                  )}
                  {after?.fee_cents != null && (
                    <p className='text-muted-foreground'>
                      {t('Payment fees')}:{' '}
                      {before?.fee_cents == null
                        ? '—'
                        : financeMoney(before.fee_cents, locale)}{' '}
                      → {financeMoney(after.fee_cents, locale)}
                    </p>
                  )}
                </div>
              )
            })}
            {!data.audits.length && (
              <p className='text-muted-foreground text-sm'>{t('No data')}</p>
            )}
          </section>
        </div>
      )}
    </Dialog>
  )
}
