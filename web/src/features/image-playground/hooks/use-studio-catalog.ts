/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useQuery } from '@tanstack/react-query'
import { t } from 'i18next'
import { z } from 'zod'

import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import type { PortraitAsset } from '../lib/portrait-elements'
import {
  importReferenceAssets,
  sourceReferenceCatalogSchema,
} from '../lib/reference-catalog'

const assetPath = z.string().regex(/^\/images\/studio\/[a-zA-Z0-9/_-]+\.webp$/)
const viewSchema = z.object({
  id: z.string().max(64),
  src: assetPath,
  instruction: z.string().max(1000),
})
export const studioCatalogSchema = z.object({
  version: z.literal(1),
  referenceCatalog: sourceReferenceCatalogSchema.optional(),
  assets: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        role: z.enum(['identity', 'outfit', 'pose', 'scene']),
        src: assetPath,
        instruction: z.string().max(2000),
        views: z.array(viewSchema).max(12),
        name: z.string().max(120).optional(),
      })
    )
    .max(10000),
})
export async function getStudioCatalog(): Promise<PortraitAsset[]> {
  const response = await api.get('/api/image-playground/catalog')
  const parsed = studioCatalogSchema.safeParse(response.data)
  if (!parsed.success) {
    throw new Error(t('Could not load the reference library.'))
  }
  return parsed.data.referenceCatalog
    ? [
        ...parsed.data.assets,
        ...importReferenceAssets(parsed.data.referenceCatalog),
      ]
    : parsed.data.assets
}
export function useStudioCatalog() {
  const scope = useAuthStore((s) => s.auth.session?.sid)
  return useQuery({
    queryKey: ['image-playground', 'catalog', scope],
    queryFn: getStudioCatalog,
    enabled: Boolean(scope),
    staleTime: 60000,
    retry: false,
    meta: { errorToast: false },
  })
}
