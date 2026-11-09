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
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'

import { ImageActions } from '../components/studio-image'
import { StudioParameters } from '../components/studio-parameters'
import { useImagePlaygroundStore } from '../store'
import { defaultImageParameters } from '../types'

const group = {
  id: '画图',
  name: 'Image generation',
  description: '',
  ratio: 1,
  models: ['mj-v8.2', 'gemini-3-pro-image-preview', 'gpt-image-2-basic'],
  available: true,
  max_resolution: 8,
  size_mode: 'upscale' as const,
  model_profiles: {
    'mj-v8.2': { size_mode: 'ratio' as const, max_resolution: 0 },
    'gemini-3-pro-image-preview': {
      size_mode: 'upscale' as const,
      max_resolution: 4,
    },
  },
}
beforeEach(() => {
  useImagePlaygroundStore.setState({
    parameters: { ...defaultImageParameters, model: 'mj-v8.2', size: '1:1' },
    references: [],
  })
})

it('shows MJ creative controls and all documented ratios without GPT output controls', () => {
  render(<StudioParameters group={group} />)
  expect(screen.getByRole('switch', { name: 'Raw mode' })).not.toBeChecked()
  expect(
    screen.getByRole('switch', { name: 'Seamless tile' })
  ).not.toBeChecked()
  expect(
    screen.getByRole('spinbutton', { name: 'Stylization' })
  ).toHaveAttribute('max', '1000')
  expect(screen.getByRole('button', { name: '5:4' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '9:21' })).toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'File format' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('group', { name: 'Resolution' })
  ).not.toBeInTheDocument()
})

it('keeps zero seed, zero strength and false switches as intentional choices and can reset them', () => {
  render(<StudioParameters group={group} />)
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Random seed' }), {
    target: { value: '0' },
  })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Stylization' }), {
    target: { value: '0' },
  })
  fireEvent.click(screen.getByRole('switch', { name: 'Raw mode' }))
  fireEvent.click(screen.getByRole('switch', { name: 'Raw mode' }))
  expect(useImagePlaygroundStore.getState().parameters.mj).toEqual({
    seed: 0,
    stylize: 0,
    raw: false,
  })
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(useImagePlaygroundStore.getState().parameters.mj).toEqual({})
})

it('exposes reference roles and enables their weights only after a URL is supplied', async () => {
  render(<StudioParameters group={group} />)
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Character, style and depth references',
    })
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Character weight' })
  ).toBeDisabled()
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Character reference' }),
    { target: { value: 'https://example.com/c.png' } }
  )
  expect(
    screen.getByRole('spinbutton', { name: 'Character weight' })
  ).toBeEnabled()
  fireEvent.change(
    screen.getByRole('spinbutton', { name: 'Character weight' }),
    { target: { value: '0' } }
  )
  fireEvent.change(
    screen.getByRole('textbox', { name: 'Character reference' }),
    { target: { value: '' } }
  )
  expect(useImagePlaygroundStore.getState().parameters.mj?.cw).toBeUndefined()
})

it('shows an inline error for an invalid reference URL', async () => {
  render(<StudioParameters group={group} />)
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Character, style and depth references',
    })
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Style reference' }), {
    target: { value: 'file:///image.png' },
  })
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter a public HTTP or HTTPS image URL.'
  )
})

it('uses the Banana panel with one output and no MJ creative fields', () => {
  useImagePlaygroundStore
    .getState()
    .setParameters({ model: 'gemini-3-pro-image-preview' })
  render(<StudioParameters group={group} />)
  expect(
    screen.queryByRole('switch', { name: 'Raw mode' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Image count' })).toHaveValue('1')
  expect(
    screen.getByText(
      'Banana returns one image per request. Size availability depends on the selected model.'
    )
  ).toBeInTheDocument()
})

it('accepts five MJ references and trims to four when switching to a Banana model', () => {
  const files = Array.from(
    { length: 5 },
    (_, index) => new File(['image'], `${index}.png`, { type: 'image/png' })
  )
  useImagePlaygroundStore.getState().addReferences(files)
  expect(useImagePlaygroundStore.getState().references).toHaveLength(5)
  expect(() =>
    useImagePlaygroundStore.getState().addReferences([files[0]])
  ).toThrow('Use up to 5 reference images.')
  useImagePlaygroundStore
    .getState()
    .setParameters({ model: 'gemini-3-pro-image-preview' })
  expect(useImagePlaygroundStore.getState().references).toHaveLength(4)
})

it('caps resolution choices at 4K even when a cached profile still advertises 8K', () => {
  useImagePlaygroundStore.getState().setParameters({
    model: 'gpt-image-2-hq',
    size: '4096x4096',
  })
  render(<StudioParameters group={group} />)
  expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.queryByRole('button', { name: '6K' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '8K' })).not.toBeInTheDocument()
})

it('offers GIF only for GPT Image 2.6 and clears the choice after switching models', async () => {
  useImagePlaygroundStore
    .getState()
    .setParameters({ model: 'gpt-image-2.6-basic' })
  render(<StudioParameters group={group} />)
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'File format' }),
    'gif'
  )
  expect(useImagePlaygroundStore.getState().parameters.format).toBe('gif')
  expect(
    screen.getByText(
      'GIF dimensions may be smaller than the requested resolution.'
    )
  ).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Quality' }), {
    target: { value: 'high' },
  })
  expect(useImagePlaygroundStore.getState().parameters.format).toBe('gif')
  act(() =>
    useImagePlaygroundStore
      .getState()
      .setParameters({ model: 'gpt-image-2-basic' })
  )
  expect(useImagePlaygroundStore.getState().parameters.format).toBe('png')
  expect(screen.queryByRole('option', { name: 'GIF' })).not.toBeInTheDocument()
})

it.each(['auto', 'gif'] as const)(
  'keeps GIF download available and disables an animated reference with %s output',
  (format) => {
    const image = { id: 'gif-image', src: 'data:image/gif;base64,R0lGODlh' }
    render(
      <ImageActions
        image={image}
        record={{
          id: 'gif-record',
          ownerId: 1,
          createdAt: 1,
          parameters: {
            ...defaultImageParameters,
            model: 'gpt-image-2.6-basic',
            format,
          },
          images: [image],
          referenceCount: 0,
        }}
      />
    )
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Continue editing' })
    ).toBeDisabled()
  }
)

it('starts a newly selected 2.6 model in auto format and preserves an explicit PNG choice', () => {
  useImagePlaygroundStore
    .getState()
    .setParameters({ model: 'gpt-image-2-basic' })
  useImagePlaygroundStore
    .getState()
    .setParameters({ model: 'gpt-image-2.6-basic' })
  expect(useImagePlaygroundStore.getState().parameters.format).toBe('auto')
  render(<StudioParameters group={group} />)
  const format = screen.getByRole('combobox', { name: 'File format' })
  expect(format).toHaveValue('auto')
  expect(screen.getByRole('option', { name: 'JPEG' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'WEBP' })).not.toBeInTheDocument()
  fireEvent.change(format, { target: { value: 'png' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Quality' }), {
    target: { value: 'high' },
  })
  expect(useImagePlaygroundStore.getState().parameters.format).toBe('png')
})

it.each(['gpt-image-2.6-flare-basic', 'gpt-image-2.6-sunburst-native'])(
  'offers SVG for %s and resets it on switching to an older model',
  async (model) => {
    useImagePlaygroundStore.getState().setParameters({ model })
    render(<StudioParameters group={group} />)
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'File format' }),
      'svg'
    )
    expect(useImagePlaygroundStore.getState().parameters.format).toBe('svg')
    act(() =>
      useImagePlaygroundStore
        .getState()
        .setParameters({ model: 'gpt-image-2.5-flare-basic' })
    )
    expect(useImagePlaygroundStore.getState().parameters.format).toBe('png')
    expect(
      screen.queryByRole('option', { name: 'SVG' })
    ).not.toBeInTheDocument()
  }
)

it('shows live editable parameters inline and keeps dimensions consistent when changing ratio and resolution', async () => {
  useImagePlaygroundStore
    .getState()
    .setParameters({ model: 'gpt-image-2.6-basic', size: '4096x4096' })
  render(<StudioParameters group={group} presentation='compact' />)
  expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toHaveValue(
    '1:1'
  )
  expect(screen.getByRole('combobox', { name: 'Resolution' })).toHaveValue('4K')
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Aspect ratio' }),
    '16:9'
  )
  expect(useImagePlaygroundStore.getState().parameters.size).toBe('4096x2304')
  expect(screen.getByText('4096 × 2304')).toBeVisible()
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Resolution' }),
    '2K'
  )
  expect(useImagePlaygroundStore.getState().parameters.size).toBe('2048x1152')
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Image count' }),
    '3'
  )
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'File format' }),
    'jpeg'
  )
  expect(
    screen.getByRole('combobox', { name: 'Image background' })
  ).toBeDisabled()
  expect(useImagePlaygroundStore.getState().parameters.count).toBe(3)
  expect(useImagePlaygroundStore.getState().parameters.background).toBe('auto')
})

it('renders native dimensions and ratio-only models correctly in inline settings', () => {
  useImagePlaygroundStore
    .getState()
    .setParameters({ model: 'gpt-image-2-native', size: '2880x2880' })
  const nativeGroup = {
    ...group,
    models: ['gpt-image-2-native'],
    size_mode: 'native' as const,
    max_resolution: 4,
  }
  const view = render(
    <StudioParameters group={nativeGroup} presentation='compact' />
  )
  expect(screen.getByRole('combobox', { name: 'Resolution' })).toHaveValue('4K')
  expect(screen.getByText('2880 × 2880')).toBeVisible()
  act(() =>
    useImagePlaygroundStore
      .getState()
      .setParameters({ model: 'mj-v8.2', size: '9:21' })
  )
  view.rerender(<StudioParameters group={group} presentation='compact' />)
  expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toHaveValue(
    '9:21'
  )
  expect(
    screen.queryByRole('combobox', { name: 'Resolution' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'File format' })
  ).not.toBeInTheDocument()
})

it('prevents inline parameter edits including Midjourney switches while submitting', async () => {
  render(<StudioParameters group={group} presentation='compact' disabled />)
  expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toBeDisabled()
  expect(screen.getByRole('switch', { name: 'Raw mode' })).toHaveAttribute(
    'aria-disabled',
    'true'
  )
  expect(screen.getByRole('spinbutton', { name: 'Stylization' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled()
  await userEvent.click(screen.getByRole('switch', { name: 'Raw mode' }))
  expect(useImagePlaygroundStore.getState().parameters.mj?.raw).not.toBe(true)
})
