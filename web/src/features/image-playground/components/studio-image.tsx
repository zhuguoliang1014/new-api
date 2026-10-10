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
import {
  Download,
  ExternalLink,
  ImagePlus,
  Loader2,
  Maximize2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import { getImageAuthScope } from '../api'
import {
  downloadImage,
  getImageBlob,
  validateReferenceFiles,
} from '../lib/images'
import { useImagePlaygroundStore } from '../store'
import type { ImageOutput, ImageRecord } from '../types'
import { ImageSizeDetails, type ImageDimensions } from './image-size-details'

export function ImageArtwork(props: {
  image: ImageOutput
  onPreview?: () => void
  requestedSize?: string
}) {
  const { t } = useTranslation()
  const [failed, setFailed] = useState(false)
  const [dimensions, setDimensions] = useState<ImageDimensions | null>(null)
  if (failed) {
    return (
      <ErrorState
        className='studio-image-error'
        title={t('Failed to load image')}
        description={t(
          'This image link may have expired. Try opening the original.'
        )}
        action={
          <Button
            variant='outline'
            render={
              <a href={props.image.src} target='_blank' rel='noreferrer' />
            }
          >
            {t('Open original')}
            <ExternalLink size={14} />
          </Button>
        }
      />
    )
  }
  return (
    <>
      <Button
        variant='ghost'
        className='studio-image-button'
        aria-label={t('Image Preview')}
        onClick={props.onPreview}
      >
        <img
          src={props.image.src}
          alt={t('Generated image')}
          loading='lazy'
          referrerPolicy='no-referrer'
          onError={() => setFailed(true)}
          onLoad={(event) => {
            const image = event.currentTarget
            if (image.naturalWidth && image.naturalHeight) {
              setDimensions({
                width: image.naturalWidth,
                height: image.naturalHeight,
              })
            }
          }}
        />
        <span className='studio-image-expand'>
          <Maximize2 size={16} aria-hidden='true' />
        </span>
      </Button>
      <ImageSizeDetails
        dimensions={dimensions}
        requestedSize={props.requestedSize}
      />
    </>
  )
}

export function ImageActions(props: {
  image: ImageOutput
  record: ImageRecord
  onReferenceUsed?: () => void
}) {
  const { t } = useTranslation()
  const [working, setWorking] = useState(false)
  const editWithReference = async () => {
    const scope = getImageAuthScope()
    setWorking(true)
    try {
      const blob = await getImageBlob(props.image.src)
      if (scope !== getImageAuthScope()) return
      const store = useImagePlaygroundStore.getState()
      if (store.job) return
      // Validate before replacing the existing draft/reference selection.
      const file = new File(
        [blob],
        `image-${props.image.id}.${blob.type.split('/')[1]}`,
        { type: blob.type }
      )
      validateReferenceFiles([file])
      store.reuseRecord(props.record)
      useImagePlaygroundStore.getState().addReferences([file])
      props.onReferenceUsed?.()
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLTextAreaElement>('#studio-prompt')?.focus()
        document
          .querySelector<HTMLTextAreaElement>('#studio-prompt')
          ?.scrollIntoView({ block: 'center' })
      })
    } catch (error) {
      handleServerError(error)
    } finally {
      setWorking(false)
    }
  }
  const download = async () => {
    setWorking(true)
    try {
      await downloadImage(props.image.src, props.image.id)
    } catch (error) {
      handleServerError(error)
    } finally {
      setWorking(false)
    }
  }
  const busy = useImagePlaygroundStore((state) => Boolean(state.job))
  return (
    <div className='studio-image-actions'>
      <Button
        variant='ghost'
        size='sm'
        disabled={working}
        onClick={() => void download()}
      >
        <Download size={15} aria-hidden='true' />
        {t('Download')}
      </Button>
      <Button
        variant='ghost'
        size='sm'
        disabled={
          working || busy || /^dall-e-/i.test(props.record.parameters.model)
        }
        onClick={() => void editWithReference()}
      >
        {working ? (
          <Loader2
            size={15}
            className='animate-spin motion-reduce:animate-none'
          />
        ) : (
          <ImagePlus size={15} aria-hidden='true' />
        )}
        {t('Continue editing')}
      </Button>
    </div>
  )
}
