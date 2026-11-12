import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

import { HupijiaoPaymentDialog } from '../hupijiao-payment-dialog'

afterEach(() => vi.useRealTimers())

test('payment checkout remains live before 30 minutes and expires exactly at 30 minutes', async () => {
  vi.useFakeTimers()
  const start = Date.now()
  vi.setSystemTime(start)
  const expired = vi.fn()
  const view = render(
    <HupijiaoPaymentDialog
      open
      onOpenChange={() => {}}
      onExpired={expired}
      payment={{
        trade_no: 'thirty-minute-test',
        pay_url: 'https://example.com/pay',
        create_time: Math.floor(start / 1000),
      }}
    />
  )
  expect(screen.getByText('30:00')).toBeVisible()
  await act(async () => {
    vi.advanceTimersByTime(3 * 60 * 1000)
  })
  expect(expired).not.toHaveBeenCalled()
  expect(screen.getByText('27:00')).toBeVisible()
  await act(async () => {
    vi.advanceTimersByTime(27 * 60 * 1000)
  })
  expect(expired).toHaveBeenCalledTimes(1)
  expect(screen.getByText('已过期')).toBeVisible()
  await act(async () => {
    vi.advanceTimersByTime(1000)
  })
  expect(expired).toHaveBeenCalledTimes(1)
  view.unmount()
})
