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
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StaticDataTable } from '@/components/data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toIntlLocale } from '@/i18n/languages'

import {
  commitFinanceImport,
  previewFinanceImport,
  saveFinanceBlob,
} from '../api'
import {
  financeCSVHeader,
  financeKindLabel,
  financeMoney,
  parseFinanceCSV,
} from '../lib'
import type { FinanceInput, FinancePreview } from '../types'

export function FinanceImportPanel(props: {
  canManage: boolean
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const [rows, setRows] = useState<FinanceInput[]>([]),
    [preview, setPreview] = useState<FinancePreview | null>(null)
  const [confirm, setConfirm] = useState(false),
    [error, setError] = useState('')
  const previewMutation = useMutation({
    mutationFn: previewFinanceImport,
    onSuccess: setPreview,
  })
  const commit = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error(t('Preview historical import'))
      return commitFinanceImport(rows, preview.hash)
    },
    onSuccess: async (result) => {
      setConfirm(false)
      setPreview(null)
      setRows([])
      toast.success(
        t('Imported {{count}} financial records', { count: result.added })
      )
      await client.invalidateQueries({ queryKey: ['finance'] })
    },
  })
  const selectFile = async (file?: File): Promise<void> => {
    setError('')
    setPreview(null)
    setRows([])
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      setError(t('Select a CSV file under 2 MB'))
      return
    }
    try {
      const input = parseFinanceCSV(await file.text())
      setRows(input)
      previewMutation.mutate(input)
    } catch {
      setError(t('Use the financial CSV template with 1 to 2000 rows'))
    }
  }
  return (
    <div className='flex flex-col gap-4'>
      <Alert>
        <AlertDescription>
          {t(
            'Historical income through October 2026 is already net of fees. Import the monthly totals once; automatic platform income starts in November 2026.'
          )}
        </AlertDescription>
      </Alert>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Import expenses from the Zhu Xiqiang sheet and gl rows only. Assign gl rows to October 2026 and preserve source references.'
        )}
      </p>
      <p className='text-muted-foreground text-sm'>
        {t(
          'The historical refund total of CNY 680 remains unallocated. Record it only after confirming the refund dates and original expenses.'
        )}
      </p>
      {props.canManage && (
        <>
          <div className='flex flex-wrap gap-3'>
            <Button
              variant='outline'
              onClick={() =>
                saveFinanceBlob(
                  new Blob([`\uFEFF${financeCSVHeader}\n`], {
                    type: 'text/csv;charset=utf-8',
                  }),
                  'finance-import-template.csv'
                )
              }
            >
              {t('Download CSV template')}
            </Button>
          </div>
          <Label htmlFor='finance-import-file'>
            {t('Preview historical import')}
          </Label>
          <Input
            id='finance-import-file'
            type='file'
            accept='.csv,text/csv'
            disabled={previewMutation.isPending || commit.isPending}
            onChange={(event) => void selectFile(event.target.files?.[0])}
          />
          <p className='text-muted-foreground text-xs'>
            {t(
              'Use expense for payments and historical_income for monthly net receipts. Amounts are in CNY. Each source_ref must be unique. No data is written until you confirm.'
            )}
          </p>
        </>
      )}
      {error && (
        <p role='alert' className='text-destructive text-sm'>
          {error}
        </p>
      )}
      {preview && (
        <>
          <p className='text-sm'>
            {t(
              'Ready: {{ready}} · Duplicates: {{duplicates}} · Errors: {{errors}}',
              {
                ready: preview.ready,
                duplicates: preview.duplicates,
                errors: preview.errors,
              }
            )}
          </p>
          <StaticDataTable
            data={preview.rows}
            getRowKey={(row) => row.line}
            columns={[
              { id: 'line', header: t('Row'), cell: (row) => row.line },
              {
                id: 'month',
                header: t('Accounting month'),
                cell: (row) => row.input.month,
              },
              {
                id: 'kind',
                header: t('Type'),
                cell: (row) => financeKindLabel(t, row.input.kind),
              },
              {
                id: 'amount',
                header: t('Amount'),
                cell: (row) => financeMoney(row.input.amount_cents, locale),
              },
              {
                id: 'source',
                header: t('Source'),
                cell: (row) => row.input.source_ref,
              },
              {
                id: 'status',
                header: t('Status'),
                cell: (row) => {
                  if (row.error) {
                    return (
                      <span className='text-destructive'>{t(row.error)}</span>
                    )
                  }
                  return row.duplicate ? t('Already imported') : t('Ready')
                },
              },
            ]}
          />
          <Button
            className='self-start'
            disabled={
              preview.errors > 0 || preview.ready === 0 || commit.isPending
            }
            onClick={() => setConfirm(true)}
          >
            {t('Confirm import')}
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('Confirm import')}
        desc={t(
          'Import the previewed records? Existing identical sources will be skipped.'
        )}
        confirmText={t('Import')}
        handleConfirm={() => commit.mutate()}
        isLoading={commit.isPending}
      />
    </div>
  )
}
