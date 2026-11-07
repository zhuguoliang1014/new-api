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

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toIntlLocale } from '@/i18n/languages'

import { downloadFinanceFile, financeAction, listFinanceEntries } from '../api'
import { financeCategories, financeKindLabel, financeMoney } from '../lib'
import type {
  FinanceCategory,
  FinanceEntry,
  FinanceFilter,
  FinanceKind,
} from '../types'
import { FinanceEntryDetails } from './entry-details'

export function FinanceLedger(props: {
  categories: FinanceCategory[]
  canExport: boolean
  filter: FinanceFilter
  canWrite: boolean
  onEdit: (entry: FinanceEntry) => void
  onRefund: (entry: FinanceEntry, kind: FinanceKind) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(''),
    [payer, setPayer] = useState(''),
    [category, setCategory] = useState('')
  const [includeVoided, setIncludeVoided] = useState(false)
  const [details, setDetails] = useState<number | null>(null),
    [voidEntry, setVoidEntry] = useState<FinanceEntry | null>(null),
    [reason, setReason] = useState('')
  const filter = {
    ...props.filter,
    page,
    search,
    payer,
    category,
    include_voided: includeVoided,
  }
  const query = useQuery({
    queryKey: ['finance', 'entries', filter],
    queryFn: () => listFinanceEntries(filter),
  })
  const categories = financeCategories(t, props.categories)
  const exportMutation = useMutation({
    mutationFn: () =>
      downloadFinanceFile(
        'export',
        `finance-${filter.from}-${filter.to}.csv`,
        filter
      ),
  })
  const voidMutation = useMutation({
    mutationFn: () => {
      if (!voidEntry) throw new Error(t('Financial record not found'))
      return financeAction(`entries/${voidEntry.id}/void`, {
        version: voidEntry.version,
        reason,
      })
    },
    onSuccess: async () => {
      setVoidEntry(null)
      setReason('')
      await client.invalidateQueries({ queryKey: ['finance'] })
    },
  })
  return (
    <div className='flex flex-col gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Input
          className='w-full sm:w-64'
          aria-label={t('Search financial records')}
          placeholder={t('Search financial records')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
        />
        {props.filter.kind === 'expense' && (
          <NativeSelect
            aria-label={t('Payer')}
            value={payer}
            onChange={(e) => {
              setPayer(e.target.value)
              setPage(1)
            }}
          >
            <NativeSelectOption value=''>{t('All payers')}</NativeSelectOption>
            <NativeSelectOption value='西强'>{t('Xiqiang')}</NativeSelectOption>
            <NativeSelectOption value='国良'>
              {t('Guoliang')}
            </NativeSelectOption>
          </NativeSelect>
        )}
        {props.filter.kind === 'expense' && (
          <NativeSelect
            aria-label={t('Category')}
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setPage(1)
            }}
          >
            <NativeSelectOption value=''>
              {t('All categories')}
            </NativeSelectOption>
            {categories.map((item) => (
              <NativeSelectOption value={item.value} key={item.value}>
                {item.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        <Label className='gap-2'>
          <Checkbox
            checked={includeVoided}
            onCheckedChange={(checked) => {
              setIncludeVoided(!!checked)
              setPage(1)
            }}
          />
          {t('Include voided entries')}
        </Label>
        {props.canExport && (
          <Button
            variant='outline'
            size='sm'
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {t('Export CSV')}
          </Button>
        )}
      </div>
      {query.isPending && <LoadingState />}
      {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <StaticDataTable
            data={query.data.items}
            getRowKey={(row) => row.id}
            emptyContent={t('No data')}
            columns={[
              {
                id: 'date',
                header: t('Date'),
                cell: (row) => row.date || row.month,
              },
              {
                id: 'type',
                header: t('Type'),
                cell: (row) => (
                  <div className='flex flex-col gap-1'>
                    <span>{financeKindLabel(t, row.kind)}</span>
                    {row.voided && (
                      <Badge variant='destructive'>{t('Voided')}</Badge>
                    )}
                  </div>
                ),
              },
              {
                id: 'party',
                header: t('Payee or reference'),
                cell: (row) => (
                  <div className='max-w-56 break-words whitespace-normal'>
                    <p>{row.counterparty || row.source_ref || row.note}</p>
                    <p className='text-muted-foreground text-xs'>
                      {row.payer}{' '}
                      {
                        categories.find((item) => item.value === row.category)
                          ?.label
                      }
                    </p>
                  </div>
                ),
              },
              {
                id: 'amount',
                header: t('Amount'),
                cell: (row) =>
                  row.currency === 'CNY'
                    ? financeMoney(row.amount_cents, locale)
                    : `${row.currency || '?'} ${(row.amount_cents / 100).toFixed(2)}`,
              },
              {
                id: 'fees',
                header: t('Payment fees'),
                cell: (row) => {
                  if (row.kind === 'historical_income') {
                    return t('Already deducted')
                  }
                  if (row.kind !== 'income') return '—'
                  if (row.fee_cents === null) return t('Needs reconciliation')
                  return (
                    <div>
                      <span>{financeMoney(row.fee_cents, locale)}</span>
                      {!row.fee_confirmed && (
                        <p className='text-muted-foreground text-xs'>
                          {t('Estimated')}
                        </p>
                      )}
                    </div>
                  )
                },
              },
              {
                id: 'actions',
                header: t('Actions'),
                cell: (row) => (
                  <div className='flex flex-wrap gap-1'>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => setDetails(row.id)}
                    >
                      {t('Details')}
                    </Button>
                    {props.canWrite && !row.voided && (
                      <>
                        {row.source !== 'payment' &&
                          row.kind !== 'historical_income' && (
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => props.onEdit(row)}
                            >
                              {t('Edit')}
                            </Button>
                          )}
                        {row.kind === 'expense' && (
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() =>
                              props.onRefund(row, 'supplier_refund')
                            }
                          >
                            {t('Supplier refund')}
                          </Button>
                        )}
                        {(row.kind === 'income' ||
                          row.kind === 'historical_income') && (
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() =>
                              props.onRefund(row, 'customer_refund')
                            }
                          >
                            {t('Customer refund')}
                          </Button>
                        )}
                        {row.kind === 'income' &&
                          row.fee_confirmed &&
                          (row.fee_cents ?? 0) > 0 && (
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => props.onRefund(row, 'fee_refund')}
                            >
                              {t('Payment fee refund')}
                            </Button>
                          )}
                        {row.source !== 'payment' && (
                          <Button
                            variant='ghost'
                            size='sm'
                            onClick={() => {
                              setVoidEntry(row)
                              setReason('')
                            }}
                          >
                            {t('Void')}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <div className='flex items-center justify-between gap-3'>
            <p className='text-muted-foreground text-sm'>
              {t('{{count}} records', { count: query.data.total })}
            </p>
            <div className='flex items-center gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                {t('Previous')}
              </Button>
              <span className='text-sm'>{page}</span>
              <Button
                variant='outline'
                size='sm'
                disabled={page * 50 >= query.data.total}
                onClick={() => setPage(page + 1)}
              >
                {t('Next')}
              </Button>
            </div>
          </div>
        </>
      )}
      {details !== null && (
        <FinanceEntryDetails
          key={details}
          id={details}
          canWrite={props.canWrite}
          onClose={() => setDetails(null)}
        />
      )}
      <ConfirmDialog
        open={voidEntry !== null}
        onOpenChange={(open) => {
          if (!open && !voidMutation.isPending) setVoidEntry(null)
        }}
        title={t('Void financial entry')}
        desc={t(
          'Voided records remain in the change history and are excluded from totals.'
        )}
        confirmText={t('Void')}
        destructive
        isLoading={voidMutation.isPending}
        disabled={!reason.trim()}
        handleConfirm={() => voidMutation.mutate()}
      >
        <Label htmlFor='void-reason'>{t('Reason for change')}</Label>
        <Input
          id='void-reason'
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
        />
      </ConfirmDialog>
    </div>
  )
}
