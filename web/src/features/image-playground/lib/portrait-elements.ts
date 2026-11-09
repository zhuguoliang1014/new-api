/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { TFunction } from 'i18next'

import type { ImageReference } from '../types'

export type PortraitSlot = 'identity' | 'outfit' | 'pose' | 'scene'
export type LocalizedReferenceText = { zh: string; en: string }
export type ReferenceFacet = LocalizedReferenceText & { id: string }
export type PortraitView = {
  id: string
  src: string
  instruction: string
  thumbnail?: string
  preview?: string
  label?: LocalizedReferenceText
  depth?: { src: string; thumbnail: string; preview: string }
}
export type PortraitAsset = {
  id: string
  role: PortraitSlot
  src: string
  instruction: string
  views: PortraitView[]
  name?: string
  thumbnail?: string
  displayTitle?: LocalizedReferenceText
  title?: LocalizedReferenceText
  code?: string
  category?: ReferenceFacet
  series?: LocalizedReferenceText
  keywords?: LocalizedReferenceText
  tags?: ReferenceFacet[]
  country?: ReferenceFacet
  hair?: string
  collection?: string
  source?: string
}

export function poseViewLabels(t: TFunction): Record<string, string> {
  return {
    original: t('Original angle'),
    front: t('Front view'),
    side: t('Side view'),
    back: t('Back view'),
  }
}

export function portraitLabels(t: TFunction): Record<string, string> {
  return {
    muse: t('Studio muse'),
    linen: t('Linen tailoring'),
    trench: t('Midnight trench'),
    knit: t('Terracotta knit'),
    denim: t('Indigo denim'),
    utility: t('Sage utility'),
    sport: t('City activewear'),
    standing: t('Relaxed standing'),
    walking: t('Walking stride'),
    seated: t('Seated portrait'),
    reaching: t('Upward stretch'),
    turning: t('Over the shoulder'),
    dynamic: t('Dynamic step'),
    courtyard: t('Sunlit courtyard'),
    charcoal: t('Charcoal studio'),
    coast: t('Coastal terrace'),
    gallery: t('Concrete gallery'),
    garden: t('Glass garden'),
    ivory: t('Ivory studio'),
  }
}

export function portraitSlotLabels(t: TFunction): Record<PortraitSlot, string> {
  return {
    identity: t('Person'),
    outfit: t('Outfit'),
    pose: t('Pose'),
    scene: t('Scene'),
  }
}

export function referenceForSlot(
  references: ImageReference[],
  slot: PortraitSlot
) {
  return references.find((ref) => ref.role === slot)
}

/** Instructions are a bounded snapshot of the selected server asset and camera view. */
export function selectedElementInstructions(
  references: ImageReference[]
): string {
  return references
    .map((ref, index) =>
      ref.assetInstruction && ref.assetRole === ref.role
        ? `Reference image ${index + 1} (${ref.role}): ${ref.assetInstruction}`
        : ''
    )
    .filter(Boolean)
    .join('\n')
}
