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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'

import { ImageArtwork } from '../components/studio-image'
import { StudioPreview } from '../components/studio-preview'

const images = [
  { id: 'first', src: 'https://images.example/first.png' },
  { id: 'second', src: 'https://images.example/second.png' },
]

beforeEach(() => {
  // Browser geometry is the uncontrolled boundary; keep the real viewer logic.
  for (const property of [
    'offsetWidth',
    'clientWidth',
    'offsetHeight',
    'clientHeight',
  ] as const) {
    vi.spyOn(HTMLElement.prototype, property, 'get').mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains('studio-viewer-viewport')) {
          return property.includes('Width') ? 800 : 600
        }
        if (this.classList.contains('studio-viewer-content')) {
          const image = this.querySelector('img')
          return property.includes('Width')
            ? image?.width || 1600
            : image?.height || 1200
        }
        return 0
      }
    )
  }
})

function PreviewFixture() {
  const [index, setIndex] = useState(0)
  return (
    <StudioPreview
      images={images}
      index={index}
      onIndexChange={setIndex}
      onClose={() => undefined}
      requestedSize='2304x3456'
    />
  )
}

function loadImage(image: HTMLElement, width: number, height: number) {
  Object.defineProperties(image, {
    naturalWidth: { configurable: true, value: width },
    naturalHeight: { configurable: true, value: height },
  })
  fireEvent.load(image)
}

it('measures the loaded original and warns when an explicit request is not honored', () => {
  render(<ImageArtwork image={images[0]} requestedSize='2304x3456' />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  loadImage(screen.getByRole('img'), 1024, 1536)
  expect(screen.getByText('Original: 1024 × 1536')).toBeInTheDocument()
  expect(screen.getByText('Requested: 2304 × 3456')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent(
    'dimensions differ from the request'
  )
})

it.each(['auto', '1024x1536'])(
  'does not warn when the size is %s and the original matches or is automatic',
  (requestedSize) => {
    render(<ImageArtwork image={images[0]} requestedSize={requestedSize} />)
    loadImage(screen.getByRole('img'), 1024, 1536)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  }
)

it('fits the original, exposes zoom percentage, and supports original size, keyboard and double-click zoom', async () => {
  render(<PreviewFixture />)
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  loadImage(screen.getByRole('img'), 1600, 1200)
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('50%')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).not.toHaveTextContent('50%')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Original size' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%')
  )
  const viewport = screen.getByRole('region', { name: 'Zoomable image' })
  viewport.focus()
  expect(viewport).toHaveFocus()
  fireEvent.keyDown(viewport, { key: '0' })
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('50%')
  )
  fireEvent.doubleClick(screen.getByRole('img'))
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%')
  )
  fireEvent.doubleClick(screen.getByRole('img'))
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('50%')
  )
  fireEvent.keyDown(viewport, { key: '1' })
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%')
  )
  fireEvent.keyDown(viewport, { key: '-' })
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).not.toHaveTextContent('100%')
  )
})

it('switches images using controls and arrow keys, then fits each newly loaded original', async () => {
  render(<PreviewFixture />)
  expect(screen.getByRole('button', { name: 'Previous image' })).toBeDisabled()
  loadImage(screen.getByRole('img'), 1600, 1200)
  fireEvent.click(screen.getByRole('button', { name: 'Original size' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
  expect(screen.getByRole('img')).toHaveAttribute('src', images[1].src)
  await waitFor(() =>
    expect(screen.getByRole('region', { name: 'Zoomable image' })).toHaveFocus()
  )
  expect(screen.getByRole('button', { name: 'Next image' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  loadImage(screen.getByRole('img'), 1600, 1200)
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('50%')
  )
  fireEvent.keyDown(screen.getByRole('region', { name: 'Zoomable image' }), {
    key: 'ArrowLeft',
  })
  expect(screen.getByRole('img')).toHaveAttribute('src', images[0].src)
})

it('keeps navigation available and disables zoom when a temporary image expires', async () => {
  render(<PreviewFixture />)
  await act(async () => fireEvent.error(screen.getByRole('img')))
  expect(screen.getByText('Failed to load image')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
  expect(screen.getByRole('img')).toHaveAttribute('src', images[1].src)
})

it('zooms a small original on double-click and returns to its fitted size', async () => {
  render(<PreviewFixture />)
  loadImage(screen.getByRole('img'), 256, 256)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled()
  )
  expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%')
  fireEvent.doubleClick(screen.getByRole('img'))
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('200%')
  )
  fireEvent.doubleClick(screen.getByRole('img'))
  await waitFor(() =>
    expect(screen.getByLabelText('Zoom level')).toHaveTextContent('100%')
  )
})

it('keeps keyboard focus through consecutive image switches without refocusing', async () => {
  render(<PreviewFixture />)
  const viewer = screen.getByRole('region', { name: 'Zoomable image' })
  viewer.focus()
  fireEvent.keyDown(viewer, { key: 'ArrowRight' })
  await waitFor(() => expect(viewer).toHaveFocus())
  expect(screen.getByRole('img')).toHaveAttribute('src', images[1].src)
  fireEvent.keyDown(viewer, { key: 'ArrowLeft' })
  expect(screen.getByRole('img')).toHaveAttribute('src', images[0].src)
  await waitFor(() => expect(viewer).toHaveFocus())
})
