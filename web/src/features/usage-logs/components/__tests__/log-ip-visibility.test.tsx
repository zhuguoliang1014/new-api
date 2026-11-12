import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

import { usageLogSchema } from '../../data/schema'
import { DetailsDialog } from '../dialogs/details-dialog'

vi.mock('@lobehub/icons', () => ({}))

const log = usageLogSchema.parse({
  id: 1,
  user_id: 7,
  created_at: 1794500000,
  type: 1,
  content: 'Top-up complete',
  ip: '203.0.113.42',
})

function showDetails(isAdmin: boolean, ip: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DetailsDialog
        log={{ ...log, ip }}
        isAdmin={isAdmin}
        isRoot={false}
        open
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>
  )
}

test('administrator sees recorded IP in a common log detail', () => {
  showDetails(true, log.ip)
  expect(screen.getByText(log.ip)).toBeVisible()
})

test('owner sees IP only when the self-log API returns it', () => {
  showDetails(false, '')
  expect(screen.queryByText(log.ip)).not.toBeInTheDocument()
  cleanup()
  showDetails(false, log.ip)
  expect(screen.getByText(log.ip)).toBeVisible()
})
