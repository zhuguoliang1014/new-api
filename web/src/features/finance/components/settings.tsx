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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { financeAction } from '../api'
import { financeCents, financeToday } from '../lib'
import type { FinanceReport } from '../types'
import { FinanceCategorySettings } from './categories'

export function FinanceSettings(props: {
  report: FinanceReport
  month: string
  canManage: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [effective, setEffective] = useState(financeToday()),
    [rate, setRate] = useState('0.60')
  const [reason, setReason] = useState(''),
    [confirm, setConfirm] = useState<'rule' | 'period' | null>(null)
  const locked = props.report.periods.some(
    (period) => period.month === props.month && period.locked
  )
  const mutation = useMutation({
    mutationFn: () => {
      if (confirm === 'rule') {
        return financeAction('rules', {
          method: 'alipay',
          effective,
          rate_bps: financeCents(rate),
        })
      }
      return financeAction('period', {
        month: props.month,
        locked: !locked,
        reason,
      })
    },
    onSuccess: async () => {
      setConfirm(null)
      setReason('')
      await client.invalidateQueries({ queryKey: ['finance'] })
    },
  })
  const rateBPS = financeCents(rate)
  return (
    <div className='flex flex-col gap-5'>
      <FinanceCategorySettings
        categories={props.report.categories}
        canManage={props.canManage}
      />
      <Alert>
        <AlertDescription>
          {t(
            'Alipay defaults to 0.6% per payment: CNY 10 paid, CNY 0.06 fee, CNY 9.94 net. Historical net income is never charged again.'
          )}
        </AlertDescription>
      </Alert>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Fee estimates are rounded per payment. New rules only affect unrecorded payments on or after their effective date; reconcile existing entries separately.'
        )}
      </p>
      <StaticDataTable
        data={props.report.rules}
        emptyContent={t('Default Alipay fee: 0.6%')}
        columns={[
          {
            id: 'method',
            header: t('Payment Method'),
            cell: (row) => row.method,
          },
          {
            id: 'effective',
            header: t('Effective date'),
            cell: (row) => row.effective,
          },
          {
            id: 'rate',
            header: t('Fee rate'),
            cell: (row) => `${(row.rate_bps / 100).toFixed(2)}%`,
          },
        ]}
      />
      {props.canManage && (
        <>
          <form
            className='flex flex-wrap items-end gap-3'
            onSubmit={(e) => {
              e.preventDefault()
              setConfirm('rule')
            }}
          >
            <div className='grid gap-2'>
              <Label htmlFor='fee-effective'>{t('Effective date')}</Label>
              <Input
                id='fee-effective'
                type='date'
                min={financeToday()}
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
                required
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='fee-rate'>{t('Alipay fee rate')} (%)</Label>
              <Input
                id='fee-rate'
                inputMode='decimal'
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                required
              />
            </div>
            <Button
              type='submit'
              disabled={rateBPS === null || rateBPS > 10000}
            >
              {t('Add fee rule')}
            </Button>
          </form>
          <section className='flex flex-col gap-3 rounded-lg border p-4'>
            <h3 className='font-medium'>
              {t('Month closing')} · {props.month}
            </h3>
            <p className='text-muted-foreground text-sm'>
              {t(
                'Reconcile fees before closing a completed month. Reopening and changes are recorded in the audit history.'
              )}
            </p>
            <Label htmlFor='period-reason'>{t('Reason for change')}</Label>
            <Input
              id='period-reason'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
            <Button
              className='self-start'
              variant='outline'
              disabled={!reason.trim()}
              onClick={() => setConfirm('period')}
            >
              {locked ? t('Reopen month') : t('Close month')}
            </Button>
          </section>
        </>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={t('Confirm financial change')}
        desc={
          confirm === 'rule'
            ? t(
                'This adds a dated payment fee rule. Existing financial entries will not be recalculated.'
              )
            : t('Change the selected financial month status?')
        }
        handleConfirm={() => mutation.mutate()}
        isLoading={mutation.isPending}
      />
    </div>
  )
}
