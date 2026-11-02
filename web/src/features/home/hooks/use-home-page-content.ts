/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import i18next from 'i18next'
import { useEffect, useState } from 'react'

import { isHttpUrl } from '@/lib/content-format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import { getHomePageContent } from '../api'
import type { HomePageContentResult } from '../types'

const STORAGE_KEY = 'home_page_content'

function readCachedContent(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/** Render a saved page (including the default empty page) while revalidating. */
export function useHomePageContent(): HomePageContentResult {
  const [cached] = useState(readCachedContent)
  const query = useQuery({
    queryKey: ['home-page-content'],
    queryFn: async () => {
      const response = requireServerSuccess(await getHomePageContent())
      const content = response.data ?? ''
      try {
        localStorage.setItem(STORAGE_KEY, content)
      } catch {
        /* Storage is optional. */
      }
      return content
    },
    staleTime: 0,
    retry: false,
    meta: { errorToast: false },
  })

  useEffect(() => {
    if (query.error) {
      handleServerError(
        query.error,
        i18next.t('Failed to load home page content')
      )
    }
  }, [query.error])

  const content = query.data ?? cached ?? ''
  return {
    content,
    isLoaded: cached !== null || !query.isPending,
    isUrl: isHttpUrl(content),
  }
}
