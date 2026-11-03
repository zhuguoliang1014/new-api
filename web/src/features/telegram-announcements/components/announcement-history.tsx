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
import { useQuery } from '@tanstack/react-query'
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage } from '@/components/data-table'
import { ErrorState } from '@/components/error-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/format'

import { listAnnouncements } from '../api'
import type { AnnouncementRecord } from '../types'

const EMPTY_RECORDS: AnnouncementRecord[] = []

export function AnnouncementHistory() {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 20 })
  const history = useQuery({
    queryKey: ['telegram-announcements', 'history', pagination.pageIndex + 1],
    queryFn: () => listAnnouncements(pagination.pageIndex + 1),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (record) =>
          record.status === 'sending' ||
          record.status === 'prepared' ||
          record.channel_status === 'sending' ||
          record.channel_status === 'queued'
      )
        ? 5000
        : false,
  })
  const columns = useMemo<ColumnDef<AnnouncementRecord>[]>(
    () => [
      {
        accessorKey: 'title',
        meta: { mobileTitle: true },
        header: t('Announcement title'),
        cell: ({ row }) => (
          <div className='max-w-md min-w-0'>
            <p className='font-medium break-words'>{row.original.title}</p>
            <p className='text-muted-foreground mt-1 line-clamp-2 text-xs break-words'>
              {row.original.body}
            </p>
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: t('Group delivery'),
        cell: ({ row }) => {
          const record = row.original
          const labels = {
            prepared: t('Sending'),
            sending: t('Sending'),
            sent: t('Published'),
            failed: t('Failed'),
            unknown: t('Delivery unconfirmed'),
          }
          return (
            <div className='space-y-1'>
              <Badge
                variant={record.status === 'sent' ? 'secondary' : 'outline'}
              >
                {labels[record.status]}
              </Badge>
              {record.pin_requested && record.status === 'sent' && (
                <p className='text-muted-foreground text-xs'>
                  {record.pin_status === 'pinned'
                    ? t('Pinned')
                    : t('Not pinned')}
                </p>
              )}
              {record.error && (
                <p className='text-muted-foreground max-w-xs text-xs'>
                  {t(record.error)}
                </p>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'channel_status',
        header: t('Channel delivery'),
        cell: ({ row }) => {
          const record = row.original
          if (!record.channel_requested) {
            return (
              <span className='text-muted-foreground text-xs'>
                {t('Not selected')}
              </span>
            )
          }
          const labels = {
            queued: t('Sending'),
            sending: t('Sending'),
            sent: t('Published'),
            failed: t('Failed'),
            unknown: t('Delivery unconfirmed'),
            '': t('Delivery unconfirmed'),
            not_requested: t('Not selected'),
          }
          return (
            <div className='space-y-1'>
              <Badge
                variant={
                  record.channel_status === 'sent' ? 'secondary' : 'outline'
                }
              >
                {labels[record.channel_status]}
              </Badge>
              <p className='text-muted-foreground max-w-xs text-xs break-words'>
                {record.channel_title}
              </p>
              {record.channel_error && (
                <p className='text-muted-foreground max-w-xs text-xs'>
                  {t(record.channel_error)}
                </p>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'created_at',
        header: t('Published at'),
        cell: ({ row }) => (
          <span className='text-xs whitespace-nowrap'>
            {formatTimestamp(row.original.created_at)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: t('Actions'),
        cell: ({ row }) => (
          <div className='flex flex-wrap gap-1'>
            {row.original.message_url && (
              <Button
                variant='ghost'
                size='sm'
                role='link'
                render={
                  <a
                    href={row.original.message_url}
                    target='_blank'
                    rel='noopener noreferrer'
                  />
                }
              >
                <ExternalLink className='size-4' aria-hidden='true' />
                {t('Group message')}
              </Button>
            )}
            {row.original.channel_message_url && (
              <Button
                variant='ghost'
                size='sm'
                role='link'
                render={
                  <a
                    href={row.original.channel_message_url}
                    target='_blank'
                    rel='noopener noreferrer'
                  />
                }
              >
                <ExternalLink className='size-4' aria-hidden='true' />
                {t('Channel message')}
              </Button>
            )}
          </div>
        ),
      },
    ],
    [t]
  )
  const table = useReactTable({
    data: history.data?.items ?? EMPTY_RECORDS,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    rowCount: history.data?.total ?? 0,
    state: { pagination },
    onPaginationChange: setPagination,
  })
  if (history.isError) {
    return (
      <ErrorState
        onRetry={() => {
          void history.refetch()
        }}
      />
    )
  }
  return (
    <div className='flex min-h-[420px] min-w-0 flex-col'>
      <DataTablePage
        table={table}
        columns={columns}
        isLoading={history.isLoading}
        isFetching={history.isFetching}
        compactPagination
        emptyTitle={t('No announcements published yet')}
        emptyDescription={t(
          'Published announcements and delivery results will appear here.'
        )}
        toolbar={
          <div className='flex items-center justify-between gap-3'>
            <p className='text-muted-foreground text-sm'>
              {t('Delivery results are saved for every publication.')}
            </p>
            <Button
              variant='outline'
              size='sm'
              disabled={history.isFetching}
              onClick={() => {
                void history.refetch()
              }}
            >
              <RefreshCw className='size-4' aria-hidden='true' />
              {t('Refresh')}
            </Button>
          </div>
        }
      />
    </div>
  )
}
