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
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it } from 'vitest'

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
