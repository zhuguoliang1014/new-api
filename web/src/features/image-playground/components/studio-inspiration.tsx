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
import { ArrowUpRight, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { stylePresets } from '../lib/style-presets'
import { useImagePlaygroundStore } from '../store'

export function StudioInspiration() {
  const { t } = useTranslation()
  const selected = useImagePlaygroundStore((state) => state.selectedStyleId)
  return (
    <div className='studio-inspiration'>
      <div className='studio-inspiration-heading'>
        <span className='studio-eyebrow'>{t('A little inspiration')}</span>
        <h2>{t('What will you create today?')}</h2>
        <p>{t('Start with a few words, or find a style that feels right.')}</p>
      </div>
      <div
        className='studio-inspiration-grid'
        role='group'
        aria-label={t('Style inspiration')}
      >
        {stylePresets.map((style) => (
          <Button
            key={style.id}
            type='button'
            variant='ghost'
            className='studio-inspiration-card'
            aria-label={t('Try {{style}}', { style: t(style.label) })}
            aria-pressed={selected === style.id}
            onClick={() => {
              useImagePlaygroundStore.setState({ selectedStyleId: style.id })
            }}
          >
            <span className='studio-inspiration-art'>
              <img src={style.previewSrc} alt='' loading='lazy' />
            </span>
            <span className='studio-inspiration-caption'>
              <span>{t(style.label)}</span>
              {selected === style.id ? (
                <Check size={15} />
              ) : (
                <ArrowUpRight size={15} />
              )}
            </span>
          </Button>
        ))}
      </div>
      <p className='studio-inspiration-note'>
        {t('Style references only. Your creations will appear here.')}
      </p>
    </div>
  )
}
