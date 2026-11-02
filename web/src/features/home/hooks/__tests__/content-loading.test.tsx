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
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { useHomePageContent } from '../use-home-page-content'

const clients: QueryClient[] = []
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  localStorage.clear()
})
function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  clients.push(client)
  return function Provider(props: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    )
  }
}

it('shows a cached empty default home immediately while refreshing slowly', async () => {
  localStorage.setItem('home_page_content', '')
  let finish!: (value: unknown) => void
  vi.spyOn(api, 'get').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const view = renderHook(() => useHomePageContent(), { wrapper: wrapper() })
  expect(view.result.current.isLoaded).toBe(true)
  expect(view.result.current.content).toBe('')
  await act(async () =>
    finish({ data: { success: true, data: '<p>Updated home</p>' } })
  )
  await waitFor(() =>
    expect(view.result.current.content).toBe('<p>Updated home</p>')
  )
})

it('deduplicates concurrent consumers and saves an empty response as a usable snapshot', async () => {
  const get = vi
    .spyOn(api, 'get')
    .mockResolvedValue({ data: { success: true, data: '' } })
  const view = renderHook(() => [useHomePageContent(), useHomePageContent()], {
    wrapper: wrapper(),
  })
  await waitFor(() =>
    expect(view.result.current.every((value) => value.isLoaded)).toBe(true)
  )
  expect(get).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem('home_page_content')).toBe('')
})

it('waits for a custom home on first visit and handles blocked storage', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage disabled')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage disabled')
  })
  let finish!: (value: unknown) => void
  vi.spyOn(api, 'get').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const view = renderHook(() => useHomePageContent(), { wrapper: wrapper() })
  expect(view.result.current.isLoaded).toBe(false)
  await act(async () =>
    finish({ data: { success: true, data: 'https://example.com/home' } })
  )
  await waitFor(() => expect(view.result.current.isLoaded).toBe(true))
  expect(view.result.current.isUrl).toBe(true)
})

it('clears a saved custom home when the server switches back to the default home', async () => {
  localStorage.setItem('home_page_content', '<p>Previous home</p>')
  vi.spyOn(api, 'get').mockResolvedValue({ data: { success: true, data: '' } })
  const view = renderHook(() => useHomePageContent(), { wrapper: wrapper() })
  expect(view.result.current.content).toBe('<p>Previous home</p>')
  await waitFor(() => expect(view.result.current.content).toBe(''))
  expect(view.result.current.isLoaded).toBe(true)
  expect(localStorage.getItem('home_page_content')).toBe('')
})

it.each(['network', 'business'])(
  'retains the saved home when a %s refresh fails',
  async (failure) => {
    localStorage.setItem('home_page_content', '<p>Saved home</p>')
    const notify = vi
      .spyOn(toast, 'error')
      .mockImplementation(() => 'home-error')
    const get = vi.spyOn(api, 'get')
    if (failure === 'network') {
      get.mockRejectedValue(new Error('Home unavailable'))
    } else {
      get.mockResolvedValue({
        data: { success: false, message: 'Home unavailable' },
      })
    }
    const view = renderHook(() => useHomePageContent(), { wrapper: wrapper() })
    await waitFor(() => expect(notify).toHaveBeenCalled())
    expect(view.result.current.content).toBe('<p>Saved home</p>')
    expect(view.result.current.isLoaded).toBe(true)
    expect(localStorage.getItem('home_page_content')).toBe('<p>Saved home</p>')
  }
)

it('leaves the loading state after a first-visit request fails', async () => {
  vi.spyOn(toast, 'error').mockImplementation(() => 'home-error')
  vi.spyOn(api, 'get').mockRejectedValue(new Error('Home unavailable'))
  const view = renderHook(() => useHomePageContent(), { wrapper: wrapper() })
  await waitFor(() => expect(view.result.current.isLoaded).toBe(true))
  expect(view.result.current.content).toBe('')
})
