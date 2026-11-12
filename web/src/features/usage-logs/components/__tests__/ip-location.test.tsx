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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { LogIPLocation } from '../log-ip-location'

const location = {
  ip: '8.8.8.8',
  country: 'China',
  country_code: 'CN',
  region: 'Beijing',
  city: 'Beijing',
  network: 'China Telecom',
}
const i18n = createInstance()
let client: QueryClient

beforeEach(async () => {
  await i18n.init({
    lng: 'zhCN',
    resources: { zhCN: zh, en },
    interpolation: { escapeValue: false },
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})
afterEach(() => client.clear())

function renderIP(ip = '8.8.8.8', enabled = true) {
  const wrapper = (props: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        {props.children}
      </QueryClientProvider>
    </I18nextProvider>
  )
  return render(<LogIPLocation ip={ip} enabled={enabled} />, { wrapper })
}

test('a cache miss displays a query action and sends no lookup until clicked', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { location: null, query_available: true } },
  })
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { location, query_available: true } },
  })
  renderIP()
  const button = await screen.findByRole('button', { name: '查询' })
  expect(button).toBeEnabled()
  expect(get).toHaveBeenCalledWith(
    '/api/log/ip-location',
    expect.objectContaining({ params: { ip: '8.8.8.8' } })
  )
  expect(post).not.toHaveBeenCalled()
  fireEvent.click(button)
  expect(await screen.findByText('北京·电信')).toBeVisible()
  expect(post).toHaveBeenCalledTimes(1)
  expect(post).toHaveBeenCalledWith('/api/log/ip-location', null, {
    params: { ip: '8.8.8.8' },
  })
})

test('a Redis cache hit displays location before the query button without an external lookup', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { location, query_available: true } },
  })
  const post = vi.spyOn(api, 'post')
  renderIP()
  const label = await screen.findByText('北京·电信')
  const button = screen.getByRole('button', { name: '查询' })
  expect(
    label.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  expect(post).not.toHaveBeenCalled()
})

test('a failed explicit lookup keeps the query action available for retry without a false location', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { location: null, query_available: true } },
  })
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      data: {
        success: false,
        message: 'IP location lookup failed. Please try again later.',
      },
    })
    .mockResolvedValueOnce({
      data: { success: true, data: { location, query_available: true } },
    })
  renderIP()
  fireEvent.click(await screen.findByRole('button', { name: '查询' }))
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
  const button = await screen.findByRole('button', { name: '查询' })
  expect(button).toBeEnabled()
  expect(screen.queryByText('北京·电信')).not.toBeInTheDocument()
  fireEvent.click(button)
  expect(await screen.findByText('北京·电信')).toBeVisible()
})

test('an active lookup disables the action until its response arrives', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { location: null, query_available: true } },
  })
  let finish!: (value: unknown) => void
  const post = vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  renderIP()
  fireEvent.click(await screen.findByRole('button', { name: '查询' }))
  const busy = await screen.findByRole('button', {
    name: i18n.t('Querying...'),
  })
  expect(busy).toBeDisabled()
  expect(busy).toHaveAttribute('aria-busy', 'true')
  fireEvent.click(busy)
  expect(post).toHaveBeenCalledTimes(1)
  await act(async () =>
    finish({
      data: { success: true, data: { location, query_available: true } },
    })
  )
  expect(await screen.findByText('北京·电信')).toBeVisible()
})

test('switching interface language updates the cached location and carrier labels', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { location, query_available: true } },
  })
  renderIP()
  expect(await screen.findByText('北京·电信')).toBeVisible()
  await act(async () => {
    await i18n.changeLanguage('en')
  })
  expect(screen.getByText('China Beijing·China Telecom')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Query IP location' })
  ).toBeVisible()
})

test('private IPs or unavailable Redis disable lookup with an explanation', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { location: null, query_available: false } },
  })
  const post = vi.spyOn(api, 'post')
  renderIP('192.168.1.1')
  const button = await screen.findByRole('button', { name: '查询' })
  expect(button).toBeDisabled()
  expect(button).toHaveAttribute(
    'title',
    '此 IP 暂不支持查询或 Redis 缓存不可用'
  )
  expect(post).not.toHaveBeenCalled()
})

test('a closed detail dialog does not request IP data', () => {
  const get = vi.spyOn(api, 'get')
  renderIP('8.8.8.8', false)
  expect(get).not.toHaveBeenCalled()
})

test('switching logs during a pending lookup never displays the previous IP location', async () => {
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: { location: null, query_available: true } },
  })
  let finish!: (value: unknown) => void
  vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const view = renderIP()
  fireEvent.click(await screen.findByRole('button', { name: '查询' }))
  await screen.findByRole('button', { name: i18n.t('Querying...') })
  view.rerender(<LogIPLocation ip='1.1.1.1' enabled />)
  await act(async () =>
    finish({
      data: { success: true, data: { location, query_available: true } },
    })
  )
  await screen.findByRole('button', { name: '查询' })
  expect(screen.getByText('1.1.1.1')).toBeVisible()
  expect(screen.queryByText('北京·电信')).not.toBeInTheDocument()
})
