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
import { Download, Plus, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toIntlLocale } from '@/i18n/languages'
import { hasPermission } from '@/lib/admin-permissions'
import { useAuthStore } from '@/stores/auth-store'

import { downloadFinanceFile, getFinanceReport, syncFinance } from './api'
import { FinanceEntryDialog } from './components/entry-dialog'
import { FinanceImportPanel } from './components/import-panel'
import { FinanceLedger } from './components/ledger'
import { FinanceOverview } from './components/overview'
import { FinanceSettings } from './components/settings'
import { financeToday } from './lib'
import type { FinanceEntry, FinanceKind } from './types'

export function Finance(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((s) => s.auth.user)
  const canRead = hasPermission(user, 'finance', 'read'),
    canWrite = hasPermission(user, 'finance', 'write'),
    canManage = hasPermission(user, 'finance', 'manage'),
    canExport = hasPermission(user, 'finance', 'export')
  const [from, setFrom] = useState(financeToday().slice(0, 7)),
    [to, setTo] = useState(financeToday().slice(0, 7))
  const [tab, setTab] = useState('overview')
  const [dialog, setDialog] = useState<{
    key: string
    kind: FinanceKind
    entry?: FinanceEntry
    related?: FinanceEntry
  } | null>(null)
  const client = useQueryClient()
  const sync = useQuery({
    queryKey: ['finance-sync'],
    queryFn: syncFinance,
    enabled: canRead,
    staleTime: 60000,
    refetchInterval: 60000,
    retry: false,
  })
  useEffect(() => {
    if (sync.dataUpdatedAt) {
      void client.invalidateQueries({ queryKey: ['finance'] })
    }
  }, [sync.dataUpdatedAt, client])
  const validRange =
    /^\d{4}-\d{2}$/.test(from) && /^\d{4}-\d{2}$/.test(to) && from <= to
  const report = useQuery({
    queryKey: ['finance', 'report', from, to],
    queryFn: () => getFinanceReport({ from, to }),
    enabled: canRead && validRange,
  })
  const exportMutation = useMutation({
    mutationFn: (summary: boolean) =>
      downloadFinanceFile(
        'export',
        `finance-${summary ? 'summary-' : ''}${from}-${to}.csv`,
        { from, to, view: summary ? 'summary' : undefined }
      ),
  })
  const newEntry = (kind: FinanceKind): void =>
    setDialog({ key: crypto.randomUUID(), kind })
  if (!canRead) return <ErrorState title={t('Access denied')} />
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Financial management')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='flex min-w-0 flex-col gap-5'>
          <div className='flex flex-wrap items-end justify-between gap-4'>
            <div className='flex flex-wrap items-end gap-3'>
              <div className='grid gap-1.5'>
                <Label htmlFor='finance-from'>{t('From month')}</Label>
                <Input
                  id='finance-from'
                  type='month'
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='finance-to'>{t('To month')}</Label>
                <Input
                  id='finance-to'
                  type='month'
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
              <Button
                variant='outline'
                size='sm'
                onClick={() => {
                  setFrom(`${financeToday().slice(0, 4)}-01`)
                  setTo(financeToday().slice(0, 7))
                }}
              >
                {t('This year')}
              </Button>
            </div>
            <div className='flex flex-wrap gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={sync.isFetching}
                onClick={() => void sync.refetch()}
              >
                <RefreshCw className='size-4' aria-hidden />
                {t('Sync income')}
              </Button>
              {canExport && tab === 'overview' && (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={!validRange || exportMutation.isPending}
                  onClick={() => exportMutation.mutate(tab === 'overview')}
                >
                  <Download className='size-4' aria-hidden />
                  {tab === 'overview'
                    ? `${t('Export')} · ${t('Monthly cash report')}`
                    : t('Export CSV')}
                </Button>
              )}
              {canWrite && (
                <Button size='sm' onClick={() => newEntry('expense')}>
                  <Plus className='size-4' aria-hidden />
                  {t('Record expense')}
                </Button>
              )}
            </div>
          </div>
          {sync.isError && (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  'Income synchronization failed. Displayed records may be incomplete; retry before relying on totals.'
                )}
              </AlertDescription>
            </Alert>
          )}
          {!validRange && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Invalid financial date range')}
            </p>
          )}
          {report.data && (
            <p className='text-muted-foreground text-xs'>
              {t('CNY · Beijing time')} · {t('Last income sync')}:{' '}
              {report.data.synced_at
                ? new Date(report.data.synced_at * 1000).toLocaleString(
                    locale,
                    { timeZone: 'Asia/Shanghai' }
                  )
                : t('Not synchronized')}
            </p>
          )}
          {report.isPending && <LoadingState />}
          {report.isError && (
            <ErrorState onRetry={() => void report.refetch()} />
          )}
          {report.data && validRange && (
            <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
              <TabsList className='flex-wrap justify-start gap-1 group-data-horizontal/tabs:h-auto'>
                <TabsTrigger className='h-8 flex-none' value='overview'>
                  {t('Monthly overview')}
                </TabsTrigger>
                <TabsTrigger className='h-8 flex-none' value='income'>
                  {t('Income records')}
                </TabsTrigger>
                <TabsTrigger className='h-8 flex-none' value='expense'>
                  {t('Expense management')}
                </TabsTrigger>
                <TabsTrigger className='h-8 flex-none' value='refunds'>
                  {t('Refund records')}
                </TabsTrigger>
                <TabsTrigger className='h-8 flex-none' value='history'>
                  {t('Historical ledger')}
                </TabsTrigger>
                <TabsTrigger className='h-8 flex-none' value='rules'>
                  {t('Financial rules')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value='overview'>
                <FinanceOverview
                  report={report.data}
                  onMonth={(month) => {
                    setFrom(month)
                    setTo(month)
                  }}
                />
              </TabsContent>
              <TabsContent value='income'>
                <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
                  <p className='text-muted-foreground text-sm'>
                    {t(
                      'Platform payments are recorded once. Balance purchases and gifted credit are excluded.'
                    )}
                  </p>
                  {canWrite && (
                    <Button
                      variant='outline'
                      onClick={() => newEntry('income')}
                    >
                      {t('Record WeChat receipt')}
                    </Button>
                  )}
                </div>
                <FinanceLedger
                  canExport={canExport}
                  categories={report.data.categories}
                  key={`income:${from}:${to}`}
                  filter={{ from, to, kind: 'income' }}
                  canWrite={canWrite}
                  onEdit={(entry) =>
                    setDialog({
                      key: String(entry.id),
                      kind: entry.kind,
                      entry,
                    })
                  }
                  onRefund={(entry, kind) =>
                    setDialog({
                      key: crypto.randomUUID(),
                      kind,
                      related: entry,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value='expense'>
                <FinanceLedger
                  canExport={canExport}
                  categories={report.data.categories}
                  key={`expense:${from}:${to}`}
                  filter={{ from, to, kind: 'expense' }}
                  canWrite={canWrite}
                  onEdit={(entry) =>
                    setDialog({
                      key: String(entry.id),
                      kind: entry.kind,
                      entry,
                    })
                  }
                  onRefund={(entry, kind) =>
                    setDialog({
                      key: crypto.randomUUID(),
                      kind,
                      related: entry,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value='refunds'>
                <FinanceLedger
                  canExport={canExport}
                  categories={report.data.categories}
                  key={`refunds:${from}:${to}`}
                  filter={{ from, to, kind: 'refunds' }}
                  canWrite={canWrite}
                  onEdit={(entry) =>
                    setDialog({
                      key: String(entry.id),
                      kind: entry.kind,
                      entry,
                    })
                  }
                  onRefund={(entry, kind) =>
                    setDialog({
                      key: crypto.randomUUID(),
                      kind,
                      related: entry,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value='history'>
                <FinanceImportPanel canManage={canManage} />
                <div className='mt-6'>
                  <FinanceLedger
                    canExport={canExport}
                    categories={report.data.categories}
                    key={`history:${from}:${to}`}
                    filter={{ from, to, source: 'import' }}
                    canWrite={canWrite}
                    onEdit={(entry) =>
                      setDialog({
                        key: String(entry.id),
                        kind: entry.kind,
                        entry,
                      })
                    }
                    onRefund={(entry, kind) =>
                      setDialog({
                        key: crypto.randomUUID(),
                        kind,
                        related: entry,
                      })
                    }
                  />
                </div>
              </TabsContent>
              <TabsContent value='rules'>
                <FinanceSettings
                  report={report.data}
                  month={to}
                  canManage={canManage}
                />
              </TabsContent>
            </Tabs>
          )}
        </div>
        {dialog && (
          <FinanceEntryDialog
            categories={report.data?.categories ?? []}
            key={dialog.key}
            kind={dialog.kind}
            entry={dialog.entry}
            related={dialog.related}
            onClose={() => setDialog(null)}
          />
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
