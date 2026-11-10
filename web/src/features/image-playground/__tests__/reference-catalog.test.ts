/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { assert, expect, it } from 'vitest'

import {
  importReferenceAssets,
  isReferenceImagePath,
  selectedPortraitView,
  sourceReferenceCatalogSchema,
} from '../lib/reference-catalog'
import {
  emptyLibraryFilters,
  filterLibraryAssets,
  libraryFacets,
} from '../lib/reference-library'

const bytes = readFileSync('../controller/resources/studio-local-catalog.json')
const source = sourceReferenceCatalogSchema.parse(JSON.parse(bytes.toString()))
const assets = importReferenceAssets(source)

it('preserves the entire pinned source catalog and all available camera angles', () => {
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    '8548d2857d814bcab46014d0fa27778c1fad1b191219faebae022912498ca828'
  )
  expect(assets).toHaveLength(2978)
  expect(new Set(assets.map((a) => a.id)).size).toBe(2978)
  expect(assets.filter((a) => a.role === 'outfit')).toHaveLength(1407)
  expect(assets.filter((a) => a.role === 'identity')).toHaveLength(1499)
  const poses = assets.filter((a) => a.role === 'pose')
  expect(poses).toHaveLength(72)
  expect(poses.flatMap((a) => a.views)).toHaveLength(360)
  for (const asset of assets) {
    const original = source.items.find((item) => item.id === asset.id)
    assert(original)
    expect(asset.title).toEqual(original.title)
    expect(asset.code).toBe(original.code)
    expect(asset.views.map((v) => v.id)).toEqual(
      original.variants.map((v) => v.id)
    )
    expect(new Set(asset.views.map((v) => v.src)).size).toBe(asset.views.length)
  }
  // Every retained group has its five actual views.
  expect(poses.every((asset) => asset.views.length === 5)).toBe(true)
})
it('uses the selected full-resolution image for generation and preserves separate previews and depth files', () => {
  const depthSource = sourceReferenceCatalogSchema.parse(
    JSON.parse(
      readFileSync(
        'src/features/image-playground/__tests__/fixtures/depth-catalog.json',
        'utf8'
      )
    )
  )
  const pose = importReferenceAssets(depthSource)[0]
  const view = selectedPortraitView(
    pose,
    'custom_pose_grid_20261105_seated_09_side:depth'
  )
  assert(view)
  expect(view.src).toContain(
    '/originals/custom_pose_grid_20261105_seated_09_side_depth.png'
  )
  expect(view.thumbnail).toContain('/thumbnails/')
  expect(view.instruction).toContain('Camera: Side')
})
it('searches bilingual titles, existing IDs and facets in the locally hosted catalog', () => {
  expect(
    filterLibraryAssets(assets, 'pose', 'full_single_P001', emptyLibraryFilters)
  ).toHaveLength(1)
  expect(
    filterLibraryAssets(assets, 'outfit', 'SPR-0001', emptyLibraryFilters)
  ).toHaveLength(1)
  expect(
    libraryFacets(assets.filter((a) => a.role === 'pose')).category.length
  ).toBeGreaterThan(0)
  for (const asset of assets) {
    for (const view of asset.views) {
      expect(view.src).toMatch(/^\/api\/image-playground\/assets\/20261110\//)
      if (asset.role === 'pose') {
        expect(view.depth?.src).toMatch(
          /\/originals\/[a-zA-Z0-9_-]+-depth\.png$/
        )
        expect(view.depth?.preview).toContain('/images/')
        expect(view.depth?.thumbnail).toContain('/thumbnails/')
      } else {
        expect(view.depth).toBeUndefined()
      }
    }
  }
})
it('rejects image URLs outside exact source hosts and image paths', () => {
  for (const url of [
    'https://bad.test/image.png',
    'https://ai-pose-gallery.pages.dev.bad.test/a.png',
    'https://ai-pose-gallery.pages.dev/a.png?token=secret',
    'https://user:password@ai-pose-gallery.pages.dev/a.png',
    'custom/pose/originals/../../a.png',
    'data:image/png;base64,a',
    'https://ai-pose-gallery.pages.dev/script.js',
  ]) {
    expect(isReferenceImagePath(url)).toBe(false)
  }
})

it('keeps every retained depth view and leaves person and outfit data unchanged', () => {
  expect(
    createHash('sha256')
      .update(
        JSON.stringify(
          (
            JSON.parse(bytes.toString()) as { items: { kind: string }[] }
          ).items.filter((item) => item.kind !== 'pose')
        )
      )
      .digest('hex')
  ).toBe('6ca975f40081eff2d94210918489c8435bac574a0d2edf2ccc8c79fb5ff6180b')
  const views = assets
    .filter((asset) => asset.role === 'pose')
    .flatMap((asset) => asset.views)
  expect(views.filter((view) => view.depth)).toHaveLength(360)
  const pose = assets.find((asset) => asset.role === 'pose')
  assert(pose)
  const plain = selectedPortraitView(pose, pose.views[0].id)
  const depth = selectedPortraitView(pose, `${pose.views[0].id}:depth`)
  expect(depth?.src).not.toBe(plain?.src)
  expect(depth?.instruction).toContain('AI inferred')
  expect(depth?.src).toBe(pose.views[0].depth?.src)
})
