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
import { ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { useAuthStore } from '@/stores/auth-store'

import { StudioComposer } from './components/studio-composer'
import { StudioGallery } from './components/studio-gallery'
import { useImageStudio } from './hooks/use-image-studio'

import '@/styles/image-studio.css'

export function ImagePlayground() {
  const scope = useAuthStore((state) => state.auth.session?.sid)
  // Remount transient dialogs/form state when the authenticated session changes.
  return <ImageStudio key={scope} />
}

function ImageStudio() {
  const { t } = useTranslation()
  const studio = useImageStudio()
  return (
    <div className='image-studio'>
      <header className='studio-header'>
        <div className='studio-header-title'>
          <div className='studio-logo'>
            <ImageIcon size={22} aria-hidden='true' />
          </div>
          <div>
            <h1>{t('Image Playground')}</h1>
            <p>{t('An idea. A few words. An entirely new image.')}</p>
          </div>
        </div>
        <span className='studio-header-tag'>
          {t('Create without limits to your imagination')}
        </span>
      </header>
      {studio.keysQuery.isError ? (
        <ErrorState
          title={t('Failed to load API keys')}
          onRetry={() => void studio.keysQuery.refetch()}
        />
      ) : (
        <div className='studio-workspace'>
          <StudioComposer
            keys={studio.keys}
            keyId={studio.keyId}
            keysLoading={studio.keysQuery.isLoading}
            models={studio.modelsQuery.data ?? []}
            modelsLoading={studio.modelsQuery.isLoading}
            modelsError={studio.modelsQuery.isError}
            retryModels={() => void studio.modelsQuery.refetch()}
            onGenerate={studio.generate}
          />
          <StudioGallery />
        </div>
      )}
    </div>
  )
}
