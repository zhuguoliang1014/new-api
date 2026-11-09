/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { TFunction } from 'i18next'
import { z } from 'zod'

import type { ImageReference } from '../types'
import { referenceForSlot } from './portrait-elements'

export const fashionShootSchema = z.object({
  body: z.enum(['reference', 'slim', 'balanced', 'athletic', 'curvy']),
  stature: z.enum(['reference', 'petite', 'regular', 'tall']),
  framing: z.enum(['full', 'three-quarter', 'waist']),
  finish: z.enum(['follow', 'catalog', 'natural', 'editorial']),
})
export type FashionShoot = z.infer<typeof fashionShootSchema>
export const defaultFashionShoot: FashionShoot = {
  body: 'reference',
  stature: 'reference',
  framing: 'full',
  finish: 'follow',
}
export function hasFashionReferences(references: ImageReference[]) {
  return Boolean(
    referenceForSlot(references, 'outfit') &&
    referenceForSlot(references, 'pose')
  )
}

/** Bounded structured choices become explicit model instructions, never fake geometric controls. */
export function fashionShootInstruction(
  shoot: FashionShoot,
  hasScene = false
): string {
  const body = {
    reference:
      'Keep the identity reference body proportions when visible; otherwise use natural adult proportions.',
    slim: 'Use a slender adult build with realistic anatomy. Preserve the reference face independently.',
    balanced:
      'Use an average-proportioned adult build with realistic anatomy. Preserve the reference face independently.',
    athletic:
      'Use an athletic adult build with realistic anatomy. Preserve the reference face independently.',
    curvy:
      'Use a fuller, curvy adult build with realistic anatomy. Preserve the reference face independently.',
  }
  const stature = {
    reference: 'Keep the person reference stature when visible.',
    petite: 'Use petite adult stature; do not portray a child.',
    regular: 'Use medium adult stature.',
    tall: 'Use tall adult stature with credible limb proportions.',
  }
  const framing = {
    full: 'Full-body composition with the entire head, hands and feet visible and comfortable margins.',
    'three-quarter':
      'Three-quarter length composition from head to below the knees; do not crop the garment hem if it is longer.',
    waist:
      'Upper-body composition from head to hips showing garment details. Preserve the upper-body gesture from the pose reference.',
  }
  return [
    'Create one coherent character image following the creative brief. Apply only the supplied reference roles. Do not create reference sheets, insets or mannequin joints. If an outfit is supplied, dress the subject in it. If an identity is absent, create a fictional adult character.',
    'The outfit reference is the product source of truth: preserve its visible silhouette, collar, seams, fastenings, print placement, color and fabric texture. Do not invent logos, labels, hidden back details or extra accessories. Adapt the drape naturally to the selected body and pose. This is a generative reference goal, not a measured fit simulation.',
    'Use the person reference only for the person, the pose reference only for gesture and viewpoint, and the scene reference only for background and lighting. Never substitute the face from a clothing reference. If no person reference exists, create a fictional adult model.',
    'Strict reference isolation: discard all backgrounds, lighting, clothing and stance from the identity photograph. Copy only facial identity, hair and the requested body proportions. The pose image controls the arm, hand and leg arrangement; do not retain the original portrait stance or put hands into pockets unless the pose shows this.',
    body[shoot.body],
    stature[shoot.stature],
    framing[shoot.framing],
    hasScene
      ? 'Follow the scene reference for the background and lighting.'
      : 'Follow the creative brief for the visual treatment and background. If unspecified, use a simple neutral background.',
  ].join('\n')
}

export function fashionShootLabels(
  t: TFunction
): Record<keyof FashionShoot, Record<string, string>> {
  return {
    body: {
      reference: t('Follow person reference'),
      slim: t('Slender'),
      balanced: t('Balanced'),
      athletic: t('Athletic'),
      curvy: t('Curvy'),
    },
    stature: {
      reference: t('Follow person reference'),
      petite: t('Petite adult'),
      regular: t('Medium stature'),
      tall: t('Tall adult'),
    },
    framing: {
      full: t('Full body'),
      'three-quarter': t('Three-quarter length'),
      waist: t('Upper body'),
    },
    finish: {
      follow: t('Follow references'),
      catalog: t('Clean catalog'),
      natural: t('Natural lifestyle'),
      editorial: t('Fashion editorial'),
    },
  }
}
