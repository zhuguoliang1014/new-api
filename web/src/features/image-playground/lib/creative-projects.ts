/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { ImageParameters } from '../types'
import type {
  CreativePlan,
  CreativeTask,
  PosterSettings,
  ReferenceRole,
} from './creative'
import type { FashionShoot } from './fashion-shoot'
import { withoutRetiredPoses } from './pose-availability'

export type CreativeProject = {
  version: 1
  id: string
  ownerId: number
  title: string
  updatedAt: number
  taskType: CreativeTask
  brief: string
  parameters: ImageParameters
  references: {
    id: string
    file: File
    role: ReferenceRole
    assetTitle?: { zh: string; en: string }
    assetId?: string
    assetView?: string
    assetRole?: ReferenceRole
    assetInstruction?: string
  }[]
  poster: PosterSettings
  shoot?: FashionShoot
  styleId?: string | null
  parentRecordId?: string
  plan?: {
    value: CreativePlan
    inputKey: string
    source: 'assistant' | 'manual'
    submitted?: boolean
    previousRecordIds?: string[]
  }
}

/** Drop withdrawn built-in images and invalidate any plan built around them. */
export function sanitizeCreativeProject(
  project: CreativeProject
): CreativeProject {
  const references = withoutRetiredPoses(project.references)
  if (references.length === project.references.length) return project
  return {
    ...project,
    references,
    plan: undefined,
    title: project.brief.trim().slice(0, 36),
  }
}

async function projectDatabase(ownerId: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(`new-api-creative-projects-${ownerId}`, 1)
    let blocked = false
    request.addEventListener('upgradeneeded', () =>
      request.result.createObjectStore('projects', { keyPath: 'id' })
    )
    request.addEventListener('success', () => {
      if (blocked) {
        request.result.close()
        return
      }
      resolve(request.result)
    })
    request.addEventListener('error', () => reject(request.error))
    request.addEventListener('blocked', () => {
      blocked = true
      reject(new Error('Project storage is unavailable.'))
    })
  })
}

export async function listCreativeProjects(
  ownerId: number
): Promise<CreativeProject[]> {
  const db = await projectDatabase(ownerId)
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly')
      const request = tx.objectStore('projects').getAll()
      tx.addEventListener('complete', () =>
        resolve(
          (request.result as CreativeProject[])
            .filter((p) => p.version === 1 && p.ownerId === ownerId)
            .map(sanitizeCreativeProject)
            .sort((a, b) => b.updatedAt - a.updatedAt)
        )
      )
      tx.addEventListener('error', () => reject(tx.error))
      tx.addEventListener('abort', () => reject(tx.error))
    })
  } finally {
    db.close()
  }
}

export async function saveCreativeProject(
  project: CreativeProject
): Promise<void> {
  const db = await projectDatabase(project.ownerId)
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('projects', 'readwrite')
      tx.objectStore('projects').put(sanitizeCreativeProject(project))
      tx.addEventListener('complete', () => resolve())
      tx.addEventListener('error', () => reject(tx.error))
      tx.addEventListener('abort', () => reject(tx.error))
    })
  } finally {
    db.close()
  }
}
