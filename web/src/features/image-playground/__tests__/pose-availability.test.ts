import { readFileSync } from 'node:fs'

import { expect, it } from 'vitest'

import {
  sanitizeCreativeProject,
  type CreativeProject,
} from '../lib/creative-projects'
import type { PortraitAsset } from '../lib/portrait-elements'
import { isRetiredPoseId, withoutRetiredPoses } from '../lib/pose-availability'
import { randomCombination } from '../lib/random-combination'
import {
  importReferenceAssets,
  sourceReferenceCatalogSchema,
} from '../lib/reference-catalog'
import {
  emptyLibraryFilters,
  filterLibraryAssets,
  libraryFacets,
} from '../lib/reference-library'
import { defaultImageParameters } from '../types'

const source = sourceReferenceCatalogSchema.parse(
  JSON.parse(
    readFileSync('../controller/resources/studio-local-catalog.json', 'utf8')
  )
)
const assets = importReferenceAssets(source)
const retiredIds = [
  'full_sexy_P001',
  'full_sexy_P080',
  'pair60_P007',
  'pair60_P061',
  'upper80v2_P026',
  'upper80v2_P051',
  'upper80v2_P080',
  'full_single_P003',
  'full_single_P059',
]
const retired: PortraitAsset = {
  id: 'pair60_P007',
  role: 'pose',
  src: '/retired.png',
  instruction: '',
  views: [{ id: 'front', src: '/retired.png', instruction: '' }],
  category: { id: 'old', zh: '后入位', en: 'Rear entry' },
}

it('serves only reviewed neutral pose groups and preserves all person and outfit references', () => {
  expect(assets.filter((asset) => asset.role === 'pose')).toHaveLength(72)
  expect(assets.filter((asset) => asset.role === 'outfit')).toHaveLength(1407)
  expect(assets.filter((asset) => asset.role === 'identity')).toHaveLength(1499)
  for (const id of retiredIds) {
    expect(isRetiredPoseId(id)).toBe(true)
    expect(assets.some((asset) => asset.id === id)).toBe(false)
  }
  const categories = libraryFacets(
    assets.filter((asset) => asset.role === 'pose')
  ).category
  expect(JSON.stringify(categories)).not.toMatch(
    /后入|挤胸|大胆|性感|骑乘|传教士/
  )
  expect(
    JSON.stringify(source.items.filter((item) => item.kind === 'pose'))
  ).not.toMatch(/后入|挤胸|大胆|性感|骑乘|传教士|揉胸|托胸/)
})

it('rejects old cached sensitive entries in catalog imports, search and random combinations', () => {
  const firstPose = source.items.find((item) => item.kind === 'pose')
  if (!firstPose) throw new Error('Missing reviewed poses')
  const old = {
    ...firstPose,
    id: 'pair60_P007',
  }
  expect(importReferenceAssets({ ...source, items: [old] })).toEqual([])
  expect(
    filterLibraryAssets(
      [...assets, retired],
      'pose',
      'pair60_P007',
      emptyLibraryFilters
    )
  ).toEqual([])
  for (const random of [() => 0, () => 0.5, () => 0.99999]) {
    const chosen = randomCombination([...assets, retired], [], random)
    expect(chosen).toHaveLength(3)
    expect(chosen.some(({ asset }) => isRetiredPoseId(asset.id))).toBe(false)
  }
})

it('removes retired poses from saved drafts and invalidates their generated proposal', () => {
  const person = {
    id: 'person',
    file: new File(['person'], 'person.png'),
    role: 'identity' as const,
  }
  const oldPose = {
    id: 'pose',
    file: new File(['pose'], 'pose.png'),
    role: 'pose' as const,
    assetId: 'pair60_P007',
  }
  const project: CreativeProject = {
    version: 1,
    id: 'saved',
    ownerId: 1,
    title: 'Old combination',
    updatedAt: 1,
    taskType: 'portrait',
    brief: 'Window light',
    parameters: defaultImageParameters,
    references: [person, oldPose],
    poster: {
      kicker: '',
      title: '',
      subtitle: '',
      color: '#ffffff',
      position: 'top',
      align: 'left',
      size: 7,
    },
    plan: {
      inputKey: 'old',
      source: 'manual',
      value: {
        title: 'Old combination',
        prompt: 'Old constraints',
        summary: 'Old summary',
        preserve: [],
        steps: ['Compose'],
      },
    },
  }
  const clean = sanitizeCreativeProject(project)
  expect(clean.references).toEqual([person])
  expect(clean.plan).toBeUndefined()
  expect(clean.title).toBe('Window light')
  expect(project.references).toHaveLength(2)
  expect(
    withoutRetiredPoses([{ assetId: 'upper80v2_P051', role: 'subject' }])
  ).toEqual([])
  expect(isRetiredPoseId('full_single_P015')).toBe(false)
  expect(isRetiredPoseId('upper80v2_P001')).toBe(false)
})
