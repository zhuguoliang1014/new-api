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
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { useCreativeModelSelection } from '../hooks/use-creative-model-selection'
import { saveStudioModelPreference } from '../lib/model-preference'
import { useImagePlaygroundStore } from '../store'
import { defaultImageParameters } from '../types'

beforeEach(() => {
  localStorage.clear()
  useImagePlaygroundStore.setState({
    parameters: defaultImageParameters,
    references: [],
  })
})

afterEach(() => useImagePlaygroundStore.getState().setScope(null))

it('preserves all references when a removed model falls back to a smaller reference limit', () => {
  const store = useImagePlaygroundStore.getState()
  store.setParameters({ group: 'old', model: 'mj-v8.2' })
  const references = Array.from({ length: 5 }, (_, index) => ({
    id: String(index),
    file: new File(['image'], `reference-${index}.png`, { type: 'image/png' }),
    preview: `blob:reference-${index}`,
  }))
  store.replaceReferences(references)
  renderHook(() =>
    useCreativeModelSelection([
      {
        id: 'basic',
        name: 'Basic',
        description: '',
        ratio: 1,
        models: ['gpt-image-2.5-flare-basic'],
        max_resolution: 4,
        size_mode: 'upscale',
        available: true,
      },
    ])
  )
  expect(useImagePlaygroundStore.getState().references).toEqual(references)
  expect(useImagePlaygroundStore.getState().parameters.model).toBe('mj-v8.2')
  act(() => useImagePlaygroundStore.getState().removeReference('4'))
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2.5-flare-basic'
  )
  expect(useImagePlaygroundStore.getState().references).toEqual(
    references.slice(0, 4)
  )
})

it('uses the GPT 2.5 upscale default even when another model comes first in the catalog', () => {
  renderHook(() =>
    useCreativeModelSelection([
      {
        id: 'images',
        name: 'Images',
        description: '',
        ratio: 1,
        models: ['gpt-image-2-native', 'gpt-image-2.5-flare-basic'],
        max_resolution: 4,
        size_mode: 'upscale',
        available: true,
      },
    ])
  )
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2.5-flare-basic'
  )
})
it('restores an available user preference and falls back if that model is removed', () => {
  useAuthStore.setState((s) => ({
    auth: { ...s.auth, user: { id: 7, username: 'artist', role: 1 } },
  }))
  saveStudioModelPreference(7, { group: 'images', model: 'gpt-image-2-native' })
  const groups = [
    {
      id: 'images',
      name: 'Images',
      description: '',
      ratio: 1,
      models: ['gpt-image-2.5-flare-basic', 'gpt-image-2-native'],
      max_resolution: 4,
      size_mode: 'upscale' as const,
      available: true,
    },
  ]
  const { rerender } = renderHook(
    ({ data }) => useCreativeModelSelection(data),
    { initialProps: { data: groups } }
  )
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2-native'
  )
  rerender({ data: [{ ...groups[0], models: ['gpt-image-2.5-flare-basic'] }] })
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2.5-flare-basic'
  )
})
