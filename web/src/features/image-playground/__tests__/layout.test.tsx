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
import { readFileSync } from 'node:fs'

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { StudioGallery } from '../components/studio-gallery'
import { useImagePlaygroundStore } from '../store'

const studioStyles = readFileSync('src/styles/image-studio.css', 'utf8')
let style: HTMLStyleElement

beforeEach(() => {
  useImagePlaygroundStore.getState().setScope(null)
  useImagePlaygroundStore.setState({
    records: [],
    selectedRecordId: null,
    job: null,
  })
  style = document.createElement('style')
  style.textContent = studioStyles
  document.head.append(style)
})

afterEach(() => {
  style.remove()
  document.documentElement.className = ''
})

it.each([1, 2])(
  'keeps the artwork background transparent on hover with %i images',
  (count) => {
    // jsdom has no pointer-driven CSS state. Map the browser's hover selector
    // to an attribute so the real stylesheet still controls the computed result.
    style.textContent = studioStyles.replaceAll(':hover', '[data-hovered]')
    useImagePlaygroundStore.setState({
      records: [
        {
          id: 'hover-record',
          ownerId: 1,
          createdAt: 1,
          parameters: useImagePlaygroundStore.getState().parameters,
          images: Array.from({ length: count }, (_, index) => ({
            id: `image-${index}`,
            src: 'data:image/png;base64,aW1hZ2U=',
          })),
          referenceCount: 0,
        },
      ],
    })
    render(
      <div className='image-studio'>
        <StudioGallery />
      </div>
    )
    for (const preview of screen.getAllByRole('button', {
      name: 'Image Preview',
    })) {
      preview.setAttribute('data-hovered', '')
      expect(getComputedStyle(preview).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    }
  }
)

it.each([1, 12])(
  'uses content height with a centered, capped scrolling history for %i creations',
  (count) => {
    const parameters = useImagePlaygroundStore.getState().parameters
    useImagePlaygroundStore.setState({
      records: Array.from({ length: count }, (_, index) => ({
        id: `record-${index}`,
        ownerId: 1,
        createdAt: 1,
        parameters: { ...parameters, prompt: `Creation ${index}` },
        images: [
          { id: `image-${index}`, src: 'data:image/png;base64,aW1hZ2U=' },
        ],
        referenceCount: 0,
      })),
    })
    render(
      <div className='image-studio'>
        <StudioGallery />
      </div>
    )
    const history = screen.getByRole('heading', {
      name: /Recent creations/,
    }).parentElement
    expect(history).toHaveStyle({
      height: 'auto',
      top: '50%',
      transform: 'translateY(-50%)',
      maxHeight: 'min(540px, 100%)',
    })
    const items = screen.getAllByRole('button', { name: /View creation/ })
    expect(items).toHaveLength(count)
    expect(items[0].parentElement).toHaveStyle({
      overflowY: 'auto',
      minHeight: '0',
    })

    const canvas = screen.getByRole('region', {
      name: 'My creations',
    }).firstElementChild
    expect(canvas).toHaveStyle({
      flex: '1 1 0%',
      minHeight: '0',
      overflowY: 'auto',
    })
    expect(canvas).toContainElement(
      screen.getByRole('button', { name: 'Image Preview' })
    )
    expect(screen.getByAltText('Generated image')).toHaveStyle({
      maxHeight: '100%',
      objectFit: 'contain',
    })
  }
)

it('keeps the empty canvas area without an empty history rail', () => {
  render(
    <div className='image-studio'>
      <StudioGallery />
    </div>
  )
  expect(
    screen.queryByRole('heading', { name: /Recent creations/ })
  ).not.toBeInTheDocument()
  const canvas = screen.getByRole('region', {
    name: 'My creations',
  }).firstElementChild
  expect(canvas).toHaveStyle({ flex: '1 1 0%', overflowY: 'auto' })
  expect(canvas).not.toHaveTextContent('Recent creations')
})

it('gives the canvas the available width and keeps the composer compact', () => {
  render(
    <div className='image-studio'>
      <div className='studio-workspace'>
        <StudioGallery />
        <div className='studio-dock'>
          <div className='studio-dock-input'>
            <textarea aria-label='Draft' className='studio-dock-prompt' />
            <div className='studio-upload-button' data-testid='upload' />
          </div>
        </div>
      </div>
    </div>
  )
  expect(screen.getByRole('region', { name: 'My creations' })).toHaveStyle({
    paddingRight: '0px',
  })
  expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveStyle({
    minHeight: '52px',
  })
  expect(screen.getByTestId('upload')).toHaveStyle({
    width: '52px',
    height: '52px',
  })
})

it.each([
  {
    theme: '',
    background: 'rgba(242, 245, 247, 0.94)',
    surface: 'rgba(255, 255, 255, 0.38)',
  },
  {
    theme: 'dark',
    background: 'rgba(35, 40, 45, 0.94)',
    surface: 'rgba(255, 255, 255, 0.1)',
  },
])(
  'uses the $theme workspace theme for portalled previews',
  ({ theme, background, surface }) => {
    document.documentElement.className = theme
    render(
      <div className='studio-preview-dialog' data-testid='preview'>
        <div className='studio-viewer'>
          <div className='studio-viewer-viewport' data-testid='viewport' />
        </div>
      </div>
    )
    expect(screen.getByTestId('preview')).toHaveStyle({
      backgroundColor: background,
    })
    // jsdom does not resolve inherited CSS custom properties. Verify the
    // surface token and its use separately; browser QA checks the rendered colour.
    expect(
      getComputedStyle(screen.getByTestId('preview'))
        .getPropertyValue('--g-surface')
        .replaceAll(' ', '')
    ).toBe(surface.replaceAll(' ', ''))
    expect(screen.getByTestId('viewport')).toHaveStyle({
      background: 'var(--g-surface)',
    })
    document.documentElement.className = ''
  }
)
