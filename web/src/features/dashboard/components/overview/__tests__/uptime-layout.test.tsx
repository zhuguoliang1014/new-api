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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { UptimePanel } from '../uptime-panel'

const originalGetAnimations = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'getAnimations'
)
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})
afterAll(() => {
  if (originalGetAnimations) {
    Object.defineProperty(
      Element.prototype,
      'getAnimations',
      originalGetAnimations
    )
  } else {
    Reflect.deleteProperty(Element.prototype, 'getAnimations')
  }
})

describe('uptime card layout', () => {
  it('wraps long service names and groups while keeping uptime visible', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            categoryName: 'AIPROXY service status',
            monitors: [
              {
                name: '国内 API 入口以及备用线路服务状态',
                group: '对外服务与客户端连接监控',
                status: 1,
                uptime: 0.9792,
              },
            ],
          },
        ],
      },
    })
    render(<UptimePanel />)
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()

    for (const text of [
      '国内 API 入口以及备用线路服务状态',
      '对外服务与客户端连接监控',
    ]) {
      const element = await screen.findByText(text)
      expect(element).toHaveClass('break-words')
      expect(element).not.toHaveClass('truncate')
    }
    expect(screen.getByText('97.92%')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
  })

  it('keeps refresh available after a failed request so the empty card can recover', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('Temporary monitoring failure'))
      .mockResolvedValueOnce({
        data: {
          success: true,
          data: [{ categoryName: 'Recovered services', monitors: [] }],
        },
      })
    render(<UptimePanel />)
    await screen.findByText('No uptime monitoring configured')

    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('Recovered services')).toBeVisible()
  })
})
