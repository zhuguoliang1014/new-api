import { useQuery } from '@tanstack/react-query'
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePagination,
  StaticDataTable,
  type StaticDataTableColumn,
} from '@/components/data-table'
import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { formatQuota, formatTimestamp } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'

export interface GiftQuotaRecord {
  id: number
  granted: number
  remaining: number
  expired: number
  granted_at: number
  expires_at: number
  expired_at: number
}

type GiftQuotaPage = { items: GiftQuotaRecord[]; total: number }

async function fetchGiftQuotaHistory(page: number): Promise<GiftQuotaPage> {
  const response = await api.get<{ success: boolean; data: GiftQuotaPage }>(
    '/api/user/self/gifts',
    { params: { p: page, page_size: 10 } }
  )
  return requireServerSuccess(response.data).data
}

interface GiftQuotaHistoryProps {
  userId?: number
  nextExpiry?: number
}

export function GiftQuotaHistory(props: GiftQuotaHistoryProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const query = useQuery({
    queryKey: ['gift-quota-history', props.userId, pagination.pageIndex],
    queryFn: () => fetchGiftQuotaHistory(pagination.pageIndex + 1),
    enabled: open && !!props.userId,
    refetchInterval: open ? 60_000 : false,
  })
  const records = query.data?.items ?? []
  const table = useReactTable({
    data: records,
    columns: [],
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: query.data?.total ?? 0,
    state: { pagination },
    onPaginationChange: setPagination,
  })
  const columns: StaticDataTableColumn<GiftQuotaRecord>[] = [
    {
      id: 'granted',
      header: t('Granted credits'),
      cell: (row) => formatQuota(row.granted),
    },
    {
      id: 'used',
      header: t('Used amount'),
      cell: (row) => formatQuota(row.granted - row.remaining - row.expired),
    },
    {
      id: 'remaining',
      header: t('Remaining quota'),
      cell: (row) => formatQuota(row.remaining),
    },
    {
      id: 'expired',
      header: t('Expired credits'),
      cell: (row) => formatQuota(row.expired),
    },
    {
      id: 'granted-at',
      header: t('Granted at'),
      cell: (row) => formatTimestamp(row.granted_at),
    },
    {
      id: 'expires-at',
      header: t('Expires at'),
      cell: (row) => formatTimestamp(row.expires_at),
    },
  ]

  return (
    <>
      <div className='flex flex-wrap items-center justify-between gap-2 text-sm'>
        <div className='text-muted-foreground space-y-1'>
          <p>
            {t(
              'Gift credits are used first and expire 30 days after grant. Purchased balance never expires.'
            )}
          </p>
          {!!props.nextExpiry && (
            <p>
              {t('Next gift expiry: {{date}}', {
                date: formatTimestamp(props.nextExpiry),
              })}
            </p>
          )}
        </div>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setOpen(true)}
          disabled={!props.userId}
        >
          {t('Gift credit history')}
        </Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t('Gift credit history')}
        description={t('View gift grants, usage and expired credits.')}
        contentHeight='auto'
        bodyClassName='space-y-4'
        contentClassName='sm:max-w-5xl'
      >
        {query.isPending && <LoadingState />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {query.isSuccess && (
          <>
            <StaticDataTable
              columns={columns}
              data={records}
              getRowKey={(row) => row.id}
              emptyContent={<EmptyState title={t('No gift credits yet')} />}
            />
            <DataTablePagination table={table} compact />
          </>
        )}
      </Dialog>
    </>
  )
}
