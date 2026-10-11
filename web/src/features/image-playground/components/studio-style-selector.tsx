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
import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { stylePresets } from '../lib/style-presets'
import { useImagePlaygroundStore } from '../store'
import { StudioImageHoverPreview } from './studio-image-hover-preview'

export function StudioStyleSelector() {
  const { t } = useTranslation()
  const labels: Record<string, string> = {
    product: t('Product photography'),
    portrait: t('Portrait'),
    cinematic: t('Cinematic'),
    neon: t('Neon night'),
    watercolor: t('Watercolor'),
    oilpainting: t('Oil painting'),
    minimal: t('Japanese minimal'),
    conceptart: t('Concept art'),
  }

  const selectedStyleId = useImagePlaygroundStore(
    (state) => state.selectedStyleId
  )
  const busy = useImagePlaygroundStore((state) => Boolean(state.job))

  return (
    <div className='studio-dock-styles' role='group' aria-label={t('Style')}>
      <Button
        variant='ghost'
        type='button'
        className='studio-dock-style-chip'
        aria-pressed={selectedStyleId === null}
        aria-label={t('No style')}
        disabled={busy}
        onClick={() =>
          useImagePlaygroundStore.setState({ selectedStyleId: null })
        }
      >
        <span className='studio-dock-style-none' aria-hidden='true'>
          ✦
        </span>
        {t('No style')}
        <Check
          className='studio-style-check'
          role='img'
          aria-label={t('Selected')}
          aria-hidden={selectedStyleId !== null}
        />
      </Button>
      {stylePresets.map((preset) => (
        <StudioImageHoverPreview
          key={preset.id}
          src={preset.previewSrc}
          label={labels[preset.id] ?? preset.label}
          trigger={
            <Button
              variant='ghost'
              type='button'
              className='studio-dock-style-chip'
              aria-label={labels[preset.id] ?? preset.label}
              aria-pressed={selectedStyleId === preset.id}
              disabled={busy}
              onClick={() =>
                useImagePlaygroundStore.setState({
                  selectedStyleId:
                    selectedStyleId === preset.id ? null : preset.id,
                })
              }
            >
              <img
                className='studio-dock-style-thumb'
                src={preset.previewSrc}
                alt=''
                aria-hidden='true'
                loading='lazy'
                referrerPolicy='no-referrer'
              />
              {labels[preset.id] ?? preset.label}
              <Check
                className='studio-style-check'
                role='img'
                aria-label={t('Selected')}
                aria-hidden={selectedStyleId !== preset.id}
              />
            </Button>
          }
        />
      ))}
    </div>
  )
}
