/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { beforeEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { getImageAuthScope } from '../api'
import { trackStudioEvent } from '../lib/studio-events'

vi.mock('../api', () => ({ getImageAuthScope: vi.fn() }))
beforeEach(() => {
  vi.mocked(getImageAuthScope).mockReturnValue('studio-scope-test')
  vi.spyOn(api, 'post').mockResolvedValue({ status: 204 })
})
it('records the usage funnel with no prompt file or image payload and deduplicates initial renders', () => {
  trackStudioEvent({ action: 'page_opened', mode: 'general' })
  trackStudioEvent({ action: 'page_opened', mode: 'general' })
  expect(api.post).toHaveBeenCalledTimes(1)
  trackStudioEvent({
    action: 'reference_selected',
    mode: 'portrait',
    role: 'pose',
    asset_id: 'full_std_P001',
  })
  expect(api.post).toHaveBeenLastCalledWith(
    '/api/image-playground/events',
    {
      event_id: expect.any(String),
      action: 'reference_selected',
      mode: 'portrait',
      role: 'pose',
      asset_id: 'full_std_P001',
    },
    expect.objectContaining({ skipAuthRefresh: true, skipErrorHandler: true })
  )
  expect(
    Object.keys(vi.mocked(api.post).mock.calls[1][1] as object).sort()
  ).toEqual(['action', 'asset_id', 'event_id', 'mode', 'role'])
})
it('ignores unavailable logging and anonymous visitors without interrupting creation', async () => {
  vi.mocked(getImageAuthScope).mockReturnValue(null)
  trackStudioEvent({ action: 'mode_selected', mode: 'portrait' })
  expect(api.post).not.toHaveBeenCalled()
  vi.mocked(getImageAuthScope).mockReturnValue('another-scope')
  vi.mocked(api.post).mockRejectedValueOnce(new Error('offline'))
  expect(() =>
    trackStudioEvent({
      action: 'library_opened',
      mode: 'portrait',
      role: 'pose',
    })
  ).not.toThrow()
  await Promise.resolve()
})
