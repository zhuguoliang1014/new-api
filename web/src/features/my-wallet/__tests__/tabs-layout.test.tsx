import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import { api } from '@/lib/api'

import { MyWallet } from '..'

it('shares mobile wallet navigation width equally while keeping desktop navigation content sized', async () => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    let data: unknown = []
    if (url === '/api/user/self') {
      data = { id: 7, username: 'wallet-user', quota: 0 }
    } else if (url === '/api/user/topup/info') {
      data = { enable_online_topup: false, enable_hupijiao_topup: false }
    } else if (url === '/api/user/aff') {
      data = 'demo'
    }
    return { data: { success: true, data } }
  })

  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <MyWallet initialTab='subscription' />
      </TooltipProvider>
    </QueryClientProvider>
  )

  const navigation = screen.getByRole('tablist')
  expect(navigation).toHaveClass(
    'grid',
    'w-full',
    'grid-cols-3',
    'sm:inline-flex',
    'sm:w-fit'
  )
  const tabs = within(navigation).getAllByRole('tab')
  expect(tabs).toHaveLength(3)
  for (const tab of tabs) {
    expect(tab).toHaveClass('w-full', 'min-w-0', 'sm:w-auto', 'sm:min-w-max')
  }
  await userEvent.click(tabs[0])
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
})
