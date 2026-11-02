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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import { usageLogSchema } from '../../data/schema'
import { getLogClientTransport } from '../../lib/format'
import type { LogOtherData } from '../../types'
import { useCommonLogsColumns } from '../columns/common-logs-columns'
import { DetailsDialog } from '../dialogs/details-dialog'
import { StreamTpsCell } from '../timing-metrics-cell'
import { UsageLogsMobileList } from '../usage-logs-mobile-card'
import { UsageLogsProvider } from '../usage-logs-provider'

const websocketLog = usageLogSchema.parse({
  id: 1,
  user_id: 2,
  type: 2,
  content: '',
  created_at: 1793630400,
  model_name: 'gpt-6-sol',
  is_stream: true,
  use_time: 2,
  completion_tokens: 20,
  other: JSON.stringify({ downstream_transport: 'websocket' }),
})

function LogTransportFixture(props: { mobile?: boolean }) {
  const columns = useCommonLogsColumns(false, false)
  const table = useReactTable({
    data: [websocketLog],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  if (props.mobile) {
    return <UsageLogsMobileList table={table} logCategory='common' />
  }
  const cell = table
    .getRowModel()
    .rows[0].getAllCells()
    .find((cell) => cell.column.id === 'is_stream')
  if (!cell) {
    throw new Error('Missing stream column in fixture')
  }
  return <>{flexRender(cell.column.columnDef.cell, cell.getContext())}</>
}

function renderLogDetails(other: LogOtherData, admin: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <DetailsDialog
        log={{ ...websocketLog, other: JSON.stringify(other) }}
        isAdmin={admin}
        isRoot={false}
        open
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>
  )
  return queryClient
}

describe('usage log transport evidence', () => {
  test.each([null, {}, { downstream_transport: 'http' }] as const)(
    'does not identify an unmarked or HTTP stream as WS: %j',
    (other) => {
      expect(getLogClientTransport(other)).not.toBe('websocket')
    }
  )
  test.each([
    { downstream_transport: 'websocket' },
    { admin_info: { downstream_transport: 'websocket' } },
    { ws: true },
  ] satisfies LogOtherData[])(
    'identifies recorded WebSocket evidence: %j',
    (other) => {
      expect(getLogClientTransport(other)).toBe('websocket')
    }
  )
  test('shows WS beside the streaming state while keeping token speed', () => {
    render(
      <StreamTpsCell
        isStream
        clientTransport='websocket'
        tokensPerSecond={10}
      />
    )
    expect(screen.getByLabelText('Connected via WebSocket')).toHaveTextContent(
      'WS'
    )
    expect(screen.getByText('Stream')).toBeVisible()
    expect(screen.getByText('10 t/s')).toBeVisible()
  })
  test('keeps normal HTTP and historical streams free of WS badges', () => {
    render(
      <>
        <StreamTpsCell isStream clientTransport='http' />
        <StreamTpsCell isStream />
      </>
    )
    expect(screen.queryByText('WS')).toBeNull()
  })
  test('does not turn asynchronous task state into a WS marker', () => {
    render(
      <StreamTpsCell isStream={false} isTask clientTransport='websocket' />
    )
    expect(screen.queryByText('WS')).toBeNull()
    expect(screen.getByText('Async')).toBeVisible()
  })
  test.each([false, true])(
    'shows the recorded client transport in the desktop/mobile list: mobile=%s',
    (mobile) => {
      render(
        <QueryClientProvider client={new QueryClient()}>
          <UsageLogsProvider>
            <LogTransportFixture mobile={mobile} />
          </UsageLogsProvider>
        </QueryClientProvider>
      )
      expect(screen.getByLabelText('Connected via WebSocket')).toBeVisible()
    }
  )
  test('shows WS client and HTTP upstream separately in admin details', () => {
    const client = renderLogDetails(
      {
        downstream_transport: 'websocket',
        admin_info: { upstream_transport: 'http' },
      },
      true
    )
    expect(
      screen.getByText('Client transport').nextElementSibling
    ).toHaveTextContent('WebSocket')
    expect(
      screen.getByText('Upstream transport').nextElementSibling
    ).toHaveTextContent('HTTP')
    client.clear()
  })
  test('shows an owner their client protocol without exposing admin upstream metadata', () => {
    const client = renderLogDetails(
      {
        downstream_transport: 'websocket',
        admin_info: { upstream_transport: 'http' },
      },
      false
    )
    expect(
      screen.getByText('Client transport').nextElementSibling
    ).toHaveTextContent('WebSocket')
    expect(screen.queryByText('Upstream transport')).toBeNull()
    expect(screen.queryByText('Audio Tokens')).toBeNull()
    client.clear()
  })
  test('does not guess transport on historical records', () => {
    const client = renderLogDetails({}, true)
    expect(screen.queryByText('Client transport')).toBeNull()
    expect(screen.queryByText('Upstream transport')).toBeNull()
    client.clear()
  })
})
