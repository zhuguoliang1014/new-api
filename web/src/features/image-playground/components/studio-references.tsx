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
import { ImagePlus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

import { useImagePlaygroundStore } from '../store'

type StudioReferencesProps = {
  supportsReferences: boolean
  onAddFiles: (files: File[]) => void
}

export function StudioReferences(props: StudioReferencesProps) {
  const { t } = useTranslation()
  const references = useImagePlaygroundStore((state) => state.references)
  const busy = useImagePlaygroundStore((state) => Boolean(state.job))
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <div className='studio-field'>
      <div className='studio-label-row'>
        <Label htmlFor='studio-reference'>
          {t('Reference images')}
          <span className='studio-optional'>{t('Optional')}</span>
        </Label>
        <span>{references.length}/4</span>
      </div>
      <input
        id='studio-reference'
        ref={fileInput}
        type='file'
        accept='image/png,image/jpeg,image/webp'
        multiple
        hidden
        disabled={busy || !props.supportsReferences}
        onChange={(event) => {
          props.onAddFiles([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
      <div
        className={`studio-upload${dragging ? ' studio-upload-dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!busy && props.supportsReferences) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (!busy && props.supportsReferences) {
            props.onAddFiles([...event.dataTransfer.files])
          }
        }}
      >
        <Button
          type='button'
          variant='ghost'
          className='studio-upload-button'
          disabled={busy || !props.supportsReferences || references.length >= 4}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus size={20} aria-hidden='true' />
          <span>
            {t('Add images to guide your creation')}
            <small>
              {t('Drop, paste or choose · PNG, JPEG, WebP · 10 MB each')}
            </small>
          </span>
        </Button>
      </div>
      {!props.supportsReferences && (
        <p className='studio-help'>
          {t('Choose a model that supports reference images.')}
        </p>
      )}
      {references.length > 0 && (
        <div className='studio-references'>
          {references.map((reference) => (
            <div key={reference.id} className='studio-reference'>
              <img src={reference.preview} alt={reference.file.name} />
              <Button
                type='button'
                variant='secondary'
                size='icon'
                disabled={busy}
                className='studio-reference-remove'
                aria-label={t('Remove reference {{name}}', {
                  name: reference.file.name,
                })}
                onClick={() =>
                  useImagePlaygroundStore
                    .getState()
                    .removeReference(reference.id)
                }
              >
                <X size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
