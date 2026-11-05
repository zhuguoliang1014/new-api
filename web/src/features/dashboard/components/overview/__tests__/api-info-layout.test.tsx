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
import { describe, expect, it, vi } from 'vitest'

import type { ApiInfoItem, PingStatus } from '@/features/dashboard/types'

import { ApiInfoItemComponent } from '../api-info-item'

const item: ApiInfoItem = {
  route: '国内 BaseUrl，只能用于请求，不能访问网站',
  description: '不能访问直连域名时，请在客户端中使用国内 API 入口。',
  url: 'https://api.sousousouju6212.top/very-long-api-endpoint-without-spaces',
  color: 'blue',
}
const idle: PingStatus = { latency: null, testing: false, error: false }

describe('API route card layout', () => {
  it('wraps long route names, descriptions and URLs instead of clipping them', () => {
    render(<ApiInfoItemComponent item={item} status={idle} onTest={vi.fn()} />)

    for (const text of [item.route, item.description, item.url]) {
      const element = screen.getByText(text)
      expect(element.className).not.toMatch(/truncate|line-clamp|\bhidden\b/)
      expect(element.className).toMatch(/break-words|break-all/)
    }
  })

  it('keeps every route action available on narrow screens', () => {
    render(<ApiInfoItemComponent item={item} status={idle} onTest={vi.fn()} />)

    for (const name of ['Test Latency', 'External Speed Test', 'Copy URL']) {
      const button = screen.getByRole('button', { name })
      expect(button.className).not.toMatch(/\bhidden\b/)
    }
    expect(
      screen.getByRole('link', { name: 'Open in New Tab' })
    ).toHaveAttribute('href', item.url)
  })

  it('allows keyboard latency testing and disables repeated tests while pending', async () => {
    const user = userEvent.setup()
    const onTest = vi.fn()
    const view = render(
      <ApiInfoItemComponent item={item} status={idle} onTest={onTest} />
    )
    const button = screen.getByRole('button', { name: 'Test Latency' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(onTest).toHaveBeenCalledWith(item.url)

    view.rerender(
      <ApiInfoItemComponent
        item={item}
        status={{ ...idle, testing: true }}
        onTest={onTest}
      />
    )
    expect(button).toBeDisabled()
    expect(screen.getByText('Testing...')).toBeVisible()
  })
})
