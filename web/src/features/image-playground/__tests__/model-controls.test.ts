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
import { expect, it } from 'vitest'

import {
  defaultImageParameters,
  getImageModelOptions,
  getImageRequestFields,
  imageParametersSchema,
  normalizeImageParameters,
} from '../types'

it('sends every supported MJ creative control including explicit zero and false values', () => {
  const fields = getImageRequestFields({
    ...defaultImageParameters,
    model: 'mj-v8.2',
    size: '5:4',
    mj: {
      raw: false,
      tile: true,
      seed: 0,
      stylize: 0,
      chaos: 40,
      weird: 150,
      negative_prompt: 'letters',
      iw: 0,
      cref: 'https://example.com/character.png',
      cw: 0,
      sref: 'https://example.com/style.png',
      sw: 0,
      dref: 'https://example.com/depth.png',
      dw: 0,
    },
  })
  expect(fields).toMatchObject({
    size: '5:4',
    raw: false,
    tile: true,
    seed: 0,
    stylize: 0,
    chaos: 40,
    weird: 150,
    negative_prompt: 'letters',
    iw: 0,
    cw: 0,
    sw: 0,
    dw: 0,
  })
  expect(fields).not.toHaveProperty('mj')
  expect(fields).not.toHaveProperty('output_format')
})

it('does not leak MJ controls into GPT or Banana requests after a model change', () => {
  for (const model of [
    'gpt-image-2-basic',
    'gemini-nano-banana-2.1',
    'gemini-2.5-flash-image',
  ]) {
    const parameters = normalizeImageParameters({
      ...defaultImageParameters,
      model,
      mj: { tile: true, seed: 0 },
    })
    expect(parameters.mj).toBeUndefined()
    expect(getImageRequestFields(parameters)).not.toHaveProperty('tile')
  }
})

it('supports all six Banana model identifiers with generation and reference inputs', () => {
  for (const model of [
    'gemini-nano-banana-2.1',
    'gemini-3-pro-image',
    'gemini-3-pro-image-preview',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-2.5-flash-image',
  ]) {
    expect(getImageModelOptions(model)).toMatchObject({
      isBanana: true,
      supportsReferences: true,
      maxCount: 1,
    })
  }
})

it.each([
  { stylize: 1001 },
  { chaos: -1 },
  { weird: 3001 },
  { seed: 1.1 },
  { iw: 3.1 },
  { cw: 101 },
  { sw: 1001 },
  { dw: -1 },
  { sref: 'file:///etc/passwd' },
])('rejects invalid MJ controls %j before sending', (mj) => {
  expect(
    imageParametersSchema.safeParse({
      ...defaultImageParameters,
      prompt: 'A tree',
      model: 'mj-v8.2',
      mj,
    }).success
  ).toBe(false)
})
