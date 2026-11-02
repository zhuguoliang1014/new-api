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
import { expect, it } from 'vitest'

import { RichContent } from '../rich-content'

it('renders HTML immediately and loads Markdown when the content mode changes', async () => {
  const view = render(<RichContent mode='html' content='<p>Site content</p>' />)
  expect(screen.getByText('Site content')).toBeVisible()
  view.rerender(<RichContent mode='markdown' content='## Markdown content' />)
  expect(
    await screen.findByRole('heading', { name: 'Markdown content' })
  ).toBeVisible()
  view.rerender(<RichContent mode='html' content='<p>Updated content</p>' />)
  expect(screen.getByText('Updated content')).toBeVisible()
})

it('keeps unsafe HTML out of rendered Markdown after loading', async () => {
  const view = render(
    <RichContent content='**Safe text**<script>alert(1)</script>' />
  )
  expect(await screen.findByText('Safe text')).toBeVisible()
  expect(view.container.querySelector('script')).toBeNull()
})
