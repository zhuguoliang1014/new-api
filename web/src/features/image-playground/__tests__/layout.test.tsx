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
    jobs: [],
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

it('keeps the editor and artwork in separate desktop columns with independent scrolling', () => {
  render(
    <div className='image-studio'>
      <div className='studio-workspace' data-testid='workspace'>
        <aside className='studio-dock'>
          <form className='studio-dock-form'>
            <div className='studio-panel-scroll' data-testid='controls'>
              Controls
            </div>
            <div className='studio-submit-area' data-testid='submit'>
              Generate
            </div>
          </form>
        </aside>
        <StudioGallery />
      </div>
    </div>
  )
  expect(screen.getByTestId('workspace')).toHaveStyle({
    display: 'grid',
    gridTemplateColumns: '360px minmax(0, 1fr)',
    minHeight: '0',
  })
  expect(screen.getByTestId('controls')).toHaveStyle({
    overflowY: 'auto',
    minHeight: '0',
  })
  expect(screen.getByTestId('submit').parentElement).toHaveStyle({
    display: 'flex',
    flexDirection: 'column',
  })
  const gallery = screen.getByRole('region', { name: 'My creations' })
  expect(gallery.querySelector('.studio-canvas')).toHaveStyle({
    overflowY: 'auto',
    minHeight: '0',
  })
})

it('keeps completed creations visible together without a separate history rail', () => {
  const parameters = useImagePlaygroundStore.getState().parameters
  useImagePlaygroundStore.setState({
    records: Array.from({ length: 3 }, (_, index) => ({
      id: `r-${index}`,
      ownerId: 1,
      createdAt: 1,
      parameters: { ...parameters, prompt: `Artwork ${index}` },
      images: [{ id: `i-${index}`, src: 'data:image/png;base64,aW1hZ2U=' }],
      referenceCount: 0,
    })),
  })
  render(
    <div className='image-studio'>
      <StudioGallery />
    </div>
  )
  expect(screen.getAllByRole('button', { name: 'Image Preview' })).toHaveLength(
    3
  )
  expect(
    screen.queryByRole('heading', { name: /Recent creations/ })
  ).not.toBeInTheDocument()
  for (const image of screen.getAllByAltText('Generated image')) {
    expect(image).toHaveStyle({ objectFit: 'contain', maxHeight: '100%' })
  }
})

it('keeps a useful empty state and the search and filters available before generation', () => {
  render(
    <div className='image-studio'>
      <StudioGallery />
    </div>
  )
  expect(screen.getByText('What will you create today?')).toBeInTheDocument()
  expect(
    screen.getByRole('textbox', { name: 'Search creations' })
  ).toBeEnabled()
  expect(
    screen.getByRole('group', { name: 'Filter creations' })
  ).toBeInTheDocument()
})

it.each([
  { theme: '', surface: '#f6f7f8', raised: '#fff' },
  { theme: 'dark', surface: '#181b20', raised: '#20242a' },
])(
  'uses opaque $theme theme surfaces for the workspace and portalled preview',
  ({ theme, surface, raised }) => {
    document.documentElement.className = theme
    render(
      <>
        <div className='image-studio' data-testid='workspace' />
        <div className='studio-preview-dialog' data-testid='preview'>
          <div className='studio-viewer'>
            <div className='studio-viewer-viewport' data-testid='viewport' />
          </div>
        </div>
      </>
    )
    for (const name of ['workspace', 'preview']) {
      const computed = getComputedStyle(screen.getByTestId(name))
      expect(computed.getPropertyValue('--g-surface').trim()).toBe(surface)
      expect(computed.getPropertyValue('--g-raised').trim()).toBe(raised)
    }
    expect(screen.getByTestId('viewport')).toHaveStyle({
      background: 'var(--g-surface)',
    })
  }
)
