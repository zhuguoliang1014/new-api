/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { z } from 'zod'

import type { PortraitAsset, PortraitView } from './portrait-elements'
import { isRetiredPoseId } from './pose-availability'
import { createReferenceTitle } from './reference-names'

/** Built-in media is served by this site from a versioned, read-only catalog. */
export function isReferenceImagePath(value: string): boolean {
  return (
    /^\/api\/image-playground\/assets\/20261110\/(?:pose|costume|character)\/(?:originals|images|thumbnails)\/[a-zA-Z0-9_-]+\.(?:png|webp)$/.test(
      value
    ) || /^\/images\/studio\/[a-zA-Z0-9/_-]+\.webp$/.test(value)
  )
}
export const referenceImagePath = z.string().refine(isReferenceImagePath)
const localizedSchema = z.object({ zh: z.string(), en: z.string() })
const facetSchema = localizedSchema.extend({ id: z.string() })
const imageSetSchema = z.object({
  original: referenceImagePath,
  image: referenceImagePath,
  thumbnail: referenceImagePath,
})
const variantSchema = imageSetSchema.extend({
  id: z.string().max(128),
  angle: z.string(),
  label: localizedSchema,
  depth: imageSetSchema.optional(),
})
export const sourceReferenceCatalogSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        kind: z.enum(['pose', 'costume', 'character']),
        code: z.string(),
        title: localizedSchema,
        category: facetSchema,
        series: localizedSchema,
        keywords: localizedSchema,
        source: z.string(),
        collection: z.literal('custom').optional(),
        tags: z.array(facetSchema).optional(),
        country: facetSchema.optional(),
        portrait: z
          .object({ section: z.enum(['face', 'styling']), hair: z.string() })
          .optional(),
        variants: z.array(variantSchema).min(1).max(12),
      })
    )
    .max(10000),
  stats: z.object({
    poseGroups: z.number(),
    poseImages: z.number(),
    costumes: z.number(),
    characters: z.number(),
    references: z.number(),
    images: z.number(),
  }),
})
export type SourceReferenceCatalog = z.infer<
  typeof sourceReferenceCatalogSchema
>

export function importReferenceAssets(
  source: SourceReferenceCatalog
): PortraitAsset[] {
  const ordinals = { pose: 0, costume: 0, character: 0 }
  return source.items
    .filter((item) => item.kind !== 'pose' || !isRetiredPoseId(item.id))
    .map((item) => {
      const displayTitle = createReferenceTitle(item, ++ordinals[item.kind])
      const role = { pose: 'pose', costume: 'outfit', character: 'identity' }[
        item.kind
      ] as PortraitAsset['role']
      const instruction = {
        pose: 'Use only the body gesture and selected camera angle. Do not copy the mannequin material, identity or clothing. The reference is an image constraint, not calibrated 3D geometry.',
        outfit:
          'Use only the clothing, footwear and accessories from this reference. Keep the separately selected person and pose.',
        identity:
          'Use this reference for the adult person identity. Clothing and body gesture come from their own selected references.',
      }[role as 'pose' | 'outfit' | 'identity']
      const views: PortraitView[] = item.variants.map((variant) => {
        const depth = variant.depth
        return {
          id: variant.id,
          src: variant.original,
          thumbnail: variant.thumbnail,
          preview: variant.image,
          label: variant.label,
          instruction:
            role === 'pose'
              ? `Camera: ${variant.label.en}. Match the selected reference viewpoint; do not mirror it. This view takes priority over other camera directions.`
              : '',
          depth: depth
            ? {
                src: depth.original,
                thumbnail: depth.thumbnail,
                preview: depth.image,
              }
            : undefined,
        }
      })
      return {
        id: item.id,
        role,
        src: views[0].src,
        thumbnail: views[0].thumbnail,
        instruction,
        views,
        name: item.title.en,
        displayTitle,
        title: item.title,
        code: item.code,
        category: item.category,
        series: item.series,
        keywords: item.keywords,
        tags: item.tags,
        country: item.country,
        hair: item.portrait?.hair,
        collection: item.collection ?? 'upstream',
        source: item.source,
      }
    })
}

export function portraitAssetName(
  asset: PortraitAsset,
  language: string
): string {
  const locale = language.startsWith('zh') ? 'zh' : 'en'
  return (
    asset.displayTitle?.[locale] ||
    asset.title?.[locale] ||
    asset.name ||
    asset.id
  )
}

export function portraitViewName(
  view: PortraitView,
  language: string,
  fallback: Record<string, string>
): string {
  return (
    view.label?.[language.startsWith('zh') ? 'zh' : 'en'] ||
    fallback[view.id] ||
    view.id
  )
}

export function selectedPortraitView(
  asset: PortraitAsset,
  viewId?: string
): PortraitView | undefined {
  const isDepth = viewId?.endsWith(':depth')
  const baseId = isDepth ? viewId?.slice(0, -6) : viewId
  const view = asset.views.find((v) => v.id === baseId) ?? asset.views[0]
  if (!view || !isDepth || !view.depth) return view
  return {
    ...view,
    ...view.depth,
    id: `${view.id}:depth`,
    instruction: `${view.instruction} Use the relative depth image only for pose and spatial layout; depth is AI inferred, not calibrated geometry. Do not reproduce the depth-map colors.`,
  }
}
