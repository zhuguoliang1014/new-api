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
import { Check, ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAuthStore } from '@/stores/auth-store'

import { StudioComposer } from './components/studio-composer'
import { StudioGallery } from './components/studio-gallery'
import { useImageStudio } from './hooks/use-image-studio'
import { useImagePlaygroundStore } from './store'

import '@/styles/image-studio.css'

export function ImagePlayground() {
  const scope = useAuthStore((state) => state.auth.session?.sid)
  return <ImageStudio key={scope} />
}

function ImageStudio() {
  const { t } = useTranslation()
  const studio = useImageStudio()

  // Keep the atmosphere in sync with the artwork currently on the canvas.
  const ambientSrc = useImagePlaygroundStore((state) => {
    const record =
      state.records.find((item) => item.id === state.selectedRecordId) ??
      state.records[0]
    return record?.images[0]?.src ?? null
  })

  return (
    <div
      className={`image-studio${ambientSrc ? ' image-studio--has-art' : ''}`}
    >
      {/* Ambient color field */}
      <div
        className={`studio-ambient-bg${ambientSrc ? ' studio-ambient-bg--has-art' : ''}`}
        style={
          ambientSrc
            ? ({
                '--ambient-src': `url(${JSON.stringify(ambientSrc)})`,
              } as React.CSSProperties)
            : undefined
        }
        aria-hidden='true'
      />
      <header className='studio-header'>
        <div className='studio-header-title'>
          <div className='studio-logo'>
            <ImageIcon size={20} aria-hidden='true' />
          </div>
          <div>
            <h1>{t('Image Playground')}</h1>
            <p>{t('An idea. A few words. An entirely new image.')}</p>
          </div>
        </div>
        <div className='studio-header-actions'>
          <span className='studio-save-state'>
            <Check size={13} aria-hidden='true' />
            {t('Local')}
          </span>
        </div>
      </header>
      {/* The dock reserves its height below the scrollable canvas. */}
      <div className='studio-workspace'>
        <StudioGallery />
        <StudioComposer
          refining={studio.refining}
          onRefine={studio.refine}
          onGenerate={studio.generate}
        />
      </div>
    </div>
  )
}
