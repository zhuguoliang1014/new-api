/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { z } from 'zod'

import type { ImageParameters, ImageReference } from '../types'
import { selectedElementInstructions } from './portrait-elements'

export const creativeTaskSchema = z.enum([
  'general',
  'portrait',
  'product',
  'poster',
])
export type CreativeTask = z.infer<typeof creativeTaskSchema>
export const referenceRoleSchema = z.enum([
  'subject',
  'identity',
  'outfit',
  'pose',
  'product',
  'scene',
  'style',
  'composition',
])
export type ReferenceRole = z.infer<typeof referenceRoleSchema>

export const creativePlanSchema = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(800),
  prompt: z.string().trim().min(1).max(6000),
  preserve: z.array(z.string().trim().min(1).max(300)).max(6),
  steps: z.array(z.string().trim().min(1).max(300)).min(1).max(4),
})
export type CreativePlan = z.infer<typeof creativePlanSchema>

export const creativeContextSchema = z.object({
  projectId: z.string().max(64),
  taskType: creativeTaskSchema,
  brief: z.string().max(16000),
  planTitle: z.string().max(120),
  parentRecordId: z.string().max(64).optional(),
  referenceRoles: z.array(referenceRoleSchema).max(5),
})
export type CreativeContext = z.infer<typeof creativeContextSchema>

export const posterSettingsSchema = z.object({
  kicker: z.string().max(120),
  title: z.string().max(300),
  subtitle: z.string().max(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  position: z.enum(['top', 'bottom']),
  align: z.enum(['left', 'center']),
  size: z.number().min(3).max(12),
})
export type PosterSettings = z.infer<typeof posterSettingsSchema>
export const defaultPosterSettings: PosterSettings = {
  kicker: 'BOTANICAL STUDIES / 01',
  title: 'Nature takes shape',
  subtitle: 'A study of light, form & the everyday.',
  color: '#26372f',
  position: 'top',
  align: 'left',
  size: 7,
}

/** Includes all generation settings and reference identities in their actual order. */
export function creativeInputKey(
  taskType: CreativeTask,
  brief: string,
  parameters: ImageParameters,
  references: ImageReference[]
): string {
  return JSON.stringify({
    taskType,
    brief,
    parameters,
    references: references.map((item) => ({
      id: item.id,
      role: item.role ?? 'subject',
      assetId: item.assetId,
      assetView: item.assetView,
      assetInstruction: item.assetInstruction,
      size: item.file.size,
      modified: item.file.lastModified,
    })),
  })
}

/** Explicit manual mode: compiles declared roles without pretending to inspect images. */
export function compileManualPrompt(
  taskType: CreativeTask,
  brief: string,
  references: ImageReference[]
): string {
  const roles = references
    .map(
      (item, index) =>
        `Reference image ${index + 1}: ${item.role ?? 'subject'} reference only.`
    )
    .join('\n')
  const constraints: Record<ReferenceRole, string> = {
    subject: 'Use as the main subject reference.',
    identity:
      'Preserve the face and hairstyle; use other references for outfit and pose.',
    outfit:
      'Use the visible garments, shoes and accessories, not the model identity.',
    pose: 'Use the action, balance and viewpoint, not the mannequin or identity.',
    product:
      'Preserve visible product shape, color and material as reference goals; do not invent labels or claims.',
    scene: 'Use only the environment and lighting.',
    style: 'Use only the color, material and visual style.',
    composition: 'Use only the framing, hierarchy and spatial arrangement.',
  }
  const details = references
    .map(
      (item, index) =>
        `Image ${index + 1}: ${constraints[item.role ?? 'subject']}`
    )
    .join('\n')
  const posterRule =
    taskType === 'poster'
      ? '\nGenerate only a key visual/background with negative space for editable typography. Do not render lettering, logos, labels or watermarks.'
      : ''
  return `${brief.trim()}\n${roles}\n${details}\n${selectedElementInstructions(references)}${posterRule}`.trim()
}
