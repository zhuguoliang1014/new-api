/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { readFileSync } from 'node:fs'

import { fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { expect, it } from 'vitest'

import { ReferenceThumbnail } from '../components/reference-thumbnail'
import {
  studioModelLabel,
  studioModelPresentation,
} from '../lib/model-presentation'
import {
  importReferenceAssets,
  portraitAssetName,
  sourceReferenceCatalogSchema,
} from '../lib/reference-catalog'
import {
  filterLibraryAssets,
  emptyLibraryFilters,
} from '../lib/reference-library'
import {
  referenceDisplayName,
  savedReferenceTitle,
} from '../lib/reference-names'

it('separates model display names and delivery labels from the exact API identifiers', () => {
  const t = i18next.t.bind(i18next)
  const basic = studioModelPresentation('gpt-image-2.6-sunburst-basic', t)
  const native = studioModelPresentation('gpt-image-2.6-sunburst-native', t)
  expect(basic.name).toBe('GPT Image 2.6 Sunburst')
  expect(native.name).toBe(basic.name)
  expect(basic.label).not.toContain('-basic')
  expect(native.label).not.toContain('-native')
  expect(basic.label).not.toBe(native.label)
  expect(studioModelLabel('gemini-3-pro-image-preview', t)).toContain(
    'Banana Pro'
  )
  expect(studioModelLabel('mj-v8.2', t)).toBe('Midjourney v8.2')
  expect(studioModelLabel('gpt-image-2.5-flare', t)).toBe('GPT Image 2.5 Flare')
})

const source = sourceReferenceCatalogSchema.parse(
  JSON.parse(
    readFileSync('../controller/resources/studio-local-catalog.json', 'utf8')
  )
)
const assets = importReferenceAssets(source)
it('gives imported references product names while retaining source IDs, files and old search aliases', () => {
  const names = assets
    .filter((a) => a.role === 'identity')
    .map((a) => portraitAssetName(a, 'zhCN'))
  expect(new Set(names).size).toBe(1499)
  for (const asset of assets) {
    expect(portraitAssetName(asset, 'zhCN')).not.toMatch(
      /custom_|202611|\.png|\.webp|[a-f0-9]{11}/
    )
    expect(portraitAssetName(asset, 'en')).not.toMatch(
      /custom_|202611|\.png|\.webp/
    )
  }
  expect(
    filterLibraryAssets(assets, 'identity', '短发人像 001', emptyLibraryFilters)
  ).toHaveLength(1)
  const pose = filterLibraryAssets(
    assets,
    'pose',
    'full_single_P015',
    emptyLibraryFilters
  )[0]
  expect(pose.id).toBe('full_single_P015')
  expect(portraitAssetName(pose, 'zhCN')).toBe(
    '站姿 · 站立，对立式平衡，手扶腰'
  )
  expect(pose.views[0].src).toContain('full_single_P015_front.png')
  expect(pose.title).toEqual(
    source.items.find((item) => item.id === pose.id)?.title
  )
})
it('resolves old library filenames and saved draft titles without changing user filenames or authored titles', () => {
  const ref = {
    id: 'old',
    file: new File(['image'], 'pose-custom_pose_grid_20261105_seated_09.webp', {
      type: 'image/webp',
    }),
    preview: 'blob:old',
    role: 'pose' as const,
    assetId: 'full_single_P015',
  }
  const t = i18next.t.bind(i18next)
  expect(referenceDisplayName(ref, t, 'zhCN', assets)).toBe(
    '站姿 · 站立，对立式平衡，手扶腰'
  )
  expect(referenceDisplayName(ref, t, 'en')).toBe('Pose')
  expect(savedReferenceTitle(ref.file.name, [ref], t, 'zhCN', assets)).toBe(
    '站姿 · 站立，对立式平衡，手扶腰'
  )
  expect(savedReferenceTitle('My design.png', [ref], t, 'en', assets)).toBe(
    'My design.png'
  )
  expect(
    referenceDisplayName(
      { ...ref, assetId: undefined, file: new File(['a'], 'my-photo.png') },
      t,
      'en'
    )
  ).toBe('my-photo.png')
})
it('shows a clear unavailable placeholder and retries the visual state when the reference source changes', () => {
  const view = render(<ReferenceThumbnail src='/first.png' alt='My pose' />)
  fireEvent.error(screen.getByRole('img', { name: 'My pose' }))
  expect(screen.getByText('Image unavailable')).toBeVisible()
  view.rerender(<ReferenceThumbnail src='/second.png' alt='My pose' />)
  expect(screen.queryByText('Image unavailable')).not.toBeInTheDocument()
  const image = screen.getByRole('img', { name: 'My pose' })
  fireEvent.load(image)
  expect(image).toHaveClass('is-ready')
})
