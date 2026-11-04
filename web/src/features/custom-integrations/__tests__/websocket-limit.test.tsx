import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { SettingsPageProvider } from '@/features/system-settings/components/settings-page-context'
import { RateLimitSection } from '@/features/system-settings/request-limits/rate-limit-section'
import { api } from '@/lib/api'

import { ResponsesWebSocketSettingsSection } from '../responses-websocket-settings-section'

const defaults = {
  ResponsesWSMaxConnectionsPerUser: 10,
}

function Fixture() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={setContainer} />
      <SettingsPageProvider actionsContainer={container}>
        <ResponsesWebSocketSettingsSection defaultValues={defaults} />
      </SettingsPageProvider>
    </>
  )
}

function showSettings() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <Fixture />
    </QueryClientProvider>
  )
  return screen.getByRole('spinbutton', {
    name: 'Responses WebSocket connections per user',
  })
}

beforeEach(() => {
  vi.spyOn(api, 'put').mockResolvedValue({ data: { success: true } })
})

it('keeps the WebSocket setting out of the standard rate limit form', () => {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <RateLimitSection
        defaultValues={{
          ModelRequestRateLimitEnabled: false,
          ModelRequestRateLimitDurationMinutes: 1,
          ModelRequestRateLimitCount: 0,
          ModelRequestRateLimitSuccessCount: 1000,
          ModelRequestRateLimitGroup: '',
        }}
      />
    </QueryClientProvider>
  )
  expect(
    screen.queryByRole('spinbutton', {
      name: 'Responses WebSocket connections per user',
    })
  ).not.toBeInTheDocument()
})

it('shows the default of ten in the add-on WebSocket settings', () => {
  expect(showSettings()).toHaveValue(10)
  expect(
    screen.getByRole('spinbutton', {
      name: 'Responses WebSocket connections per user',
    })
  ).toBeEnabled()
})

it('saves only the changed WebSocket limit through the administrator options API', async () => {
  const input = showSettings()
  fireEvent.change(input, { target: { value: '20' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  await waitFor(() =>
    expect(api.put).toHaveBeenCalledExactlyOnceWith('/api/option/', {
      key: 'ResponsesWSMaxConnectionsPerUser',
      value: 20,
    })
  )
})

it.each(['', '0', '-1', '1.5', '1001'])(
  'rejects limit "%s" and leaves the saved value unchanged',
  async (value) => {
    const input = showSettings()
    fireEvent.change(input, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    expect(api.put).not.toHaveBeenCalled()
  }
)
