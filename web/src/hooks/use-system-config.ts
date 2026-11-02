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
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useCallback } from 'react'

import { getBrandingImage } from '@/lib/branding-images'
import { DEFAULT_LOGO } from '@/lib/constants'
import { applyFaviconToDom } from '@/lib/dom-utils'
import { preloadImage } from '@/lib/image-preload'
import { ensureStatus } from '@/lib/status-query'
import { useSystemConfigStore } from '@/stores/system-config-store'

interface UseSystemConfigOptions {
  /** Automatically fetch config from backend (use only in root component) */
  autoLoad?: boolean
}

/**
 * System configuration hook with auto-loading and logo preloading
 *
 * @example
 * // Root component - auto-load from backend
 * useSystemConfig({ autoLoad: true })
 *
 * @example
 * // Other components - use cached config
 * const { systemName, logo, loading } = useSystemConfig()
 */
export function useSystemConfig(options: UseSystemConfigOptions = {}) {
  const { autoLoad = false } = options
  const queryClient = useQueryClient()
  const { config, loading, loadedLogoUrl, setLoadedLogoUrl, setLoading } =
    useSystemConfigStore()

  // Load config from backend via the shared `/api/status` cache.
  // `ensureStatus` writes the mapped config into this store itself, so there is
  // no second request and no second mapping path here.
  const loadConfig = useCallback(async () => {
    try {
      setLoading(true)
      await ensureStatus(queryClient)
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load system config:', error)
    } finally {
      setLoading(false)
    }
  }, [queryClient, setLoading])

  useEffect(() => {
    if (autoLoad) loadConfig()
  }, [autoLoad, loadConfig])

  // Preload logo image when URL changes
  useEffect(() => {
    const { logo } = config

    // Skip if logo is already loaded
    if (!logo || logo === loadedLogoUrl) return

    let active = true
    void preloadImage(getBrandingImage(logo)).then(
      () => {
        if (!active) return
        setLoadedLogoUrl(logo)
        applyFaviconToDom(logo)
      },
      () => {
        if (!active) return
        if (logo !== DEFAULT_LOGO) {
          // eslint-disable-next-line no-console
          console.error('Failed to load logo:', logo)
        }
        setLoadedLogoUrl(logo)
      }
    )
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.logo, loadedLogoUrl, setLoadedLogoUrl])

  return {
    ...config,
    logo: getBrandingImage(config.logo),
    loading,
    logoLoaded: config.logo === loadedLogoUrl && !!loadedLogoUrl,
  }
}
