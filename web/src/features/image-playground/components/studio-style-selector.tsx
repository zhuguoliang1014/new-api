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
import { Maximize2 } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import { stylePresets, type StylePreset } from '../lib/style-presets'
import { useImagePlaygroundStore } from '../store'

const StudioPreview = lazy(() =>
  import('./studio-preview').then((module) => ({
    default: module.StudioPreview,
  }))
)

export function StudioStyleSelector() {
  const { t } = useTranslation()
  const selectedStyleId = useImagePlaygroundStore(
    (state) => state.selectedStyleId
  )
  const selectedStyle = stylePresets.find(
    (preset) => preset.id === selectedStyleId
  )
  const [preview, setPreview] = useState<StylePreset | null>(null)
  return (
    <div className='studio-field' role='group' aria-label={t('Style')}>
      <Label htmlFor='studio-style'>{t('Style')}</Label>
      <NativeSelect
        id='studio-style'
        className='studio-native-select'
        value={selectedStyleId ?? ''}
        onChange={(event) =>
          useImagePlaygroundStore.setState({
            selectedStyleId: event.target.value || null,
          })
        }
      >
        <NativeSelectOption value=''>{t('No style')}</NativeSelectOption>
        {stylePresets.map((preset) => (
          <NativeSelectOption key={preset.id} value={preset.id}>
            {t(preset.label)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {selectedStyle && (
        <Button
          type='button'
          variant='ghost'
          className='studio-selected-style-preview'
          aria-label={t('Style inspiration')}
          aria-haspopup='dialog'
          onClick={() => setPreview(selectedStyle)}
        >
          <img src={selectedStyle.previewSrc} alt={t(selectedStyle.label)} />
          <span className='studio-selected-style-caption'>
            <span>{t('Style inspiration')}</span>
            <Maximize2 size={15} aria-hidden='true' />
          </span>
        </Button>
      )}
      {preview && (
        <Suspense fallback={<LoadingState />}>
          <StudioPreview
            title={t(preview.label)}
            images={[{ id: preview.id, src: preview.previewSrc }]}
            index={0}
            onIndexChange={() => undefined}
            onClose={() => setPreview(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
