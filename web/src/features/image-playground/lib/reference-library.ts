/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type {
  PortraitAsset,
  PortraitSlot,
  ReferenceFacet,
} from './portrait-elements'
import { isRetiredPoseId } from './pose-availability'

export type LibraryFilters = {
  category: string
  collection: string
  subject: string
  style: string
  country: string
  hair: string
}
export const emptyLibraryFilters: LibraryFilters = {
  category: '',
  collection: '',
  subject: '',
  style: '',
  country: '',
  hair: '',
}
export const subjectTags = new Set(['female', 'male', 'model', 'dance'])
export function libraryFacets(assets: PortraitAsset[]) {
  const collect = (values: (ReferenceFacet | undefined)[]) => [
    ...new Map(
      values
        .filter((v): v is ReferenceFacet => Boolean(v))
        .map((v) => [v.id, v])
    ).values(),
  ]
  const tags = collect(assets.flatMap((a) => a.tags ?? []))
  return {
    category: collect(assets.map((a) => a.category)),
    subject: tags.filter((t) => subjectTags.has(t.id)),
    style: tags.filter((t) => !subjectTags.has(t.id)),
    country: collect(assets.map((a) => a.country)),
    hair: [
      ...new Set(
        assets
          .map((a) => a.hair)
          .filter((hair): hair is string => Boolean(hair))
      ),
    ],
  }
}
export function filterLibraryAssets(
  assets: PortraitAsset[],
  role: PortraitSlot,
  query: string,
  filters: LibraryFilters
): PortraitAsset[] {
  const exactQuery = query.normalize('NFKC').toLowerCase().trim()
  const exactMatches = exactQuery
    ? assets.filter(
        (asset) =>
          asset.role === role &&
          [asset.code, ...Object.values(asset.displayTitle ?? {})].some(
            (value) => value?.normalize('NFKC').toLowerCase() === exactQuery
          )
      )
    : []
  const candidates = exactMatches.length ? exactMatches : assets
  const words = query
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return candidates.filter((asset) => {
    if (
      asset.role !== role ||
      isRetiredPoseId(asset.id) ||
      (filters.category && asset.category?.id !== filters.category) ||
      (filters.collection && asset.collection !== filters.collection) ||
      (filters.country && asset.country?.id !== filters.country) ||
      (filters.hair && asset.hair !== filters.hair)
    ) {
      return false
    }
    if (
      [filters.subject, filters.style].some(
        (tag) => tag && !asset.tags?.some((t) => t.id === tag)
      )
    ) {
      return false
    }
    const terms = [
      asset.id,
      asset.code,
      asset.name,
      ...Object.values(asset.title ?? {}),
      ...Object.values(asset.displayTitle ?? {}),
      ...Object.values(asset.category ?? {}),
      ...Object.values(asset.series ?? {}),
      ...Object.values(asset.keywords ?? {}),
      ...Object.values(asset.country ?? {}),
      ...(asset.tags ?? []).flatMap((tag) => Object.values(tag)),
    ]
      .join(' ')
      .normalize('NFKC')
      .toLowerCase()
    return words.every((word) => terms.includes(word))
  })
}
