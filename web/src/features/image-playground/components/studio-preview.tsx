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
  ChevronLeft,
  ChevronRight,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchContentRef,
} from 'react-zoom-pan-pinch'

import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import type { ImageOutput } from '../types'
import { ImageSizeDetails, type ImageDimensions } from './image-size-details'

function ZoomableImage(props: { image: ImageOutput; requestedSize?: string }) {
  const { t, i18n } = useTranslation()
  const transform = useRef<ReactZoomPanPinchContentRef>(null)
  const [zoom, setZoom] = useState({ imageId: props.image.id, scale: 1 })
  const [loaded, setLoaded] = useState<{
    imageId: string
    dimensions: ImageDimensions
  } | null>(null)
  const [failedId, setFailedId] = useState<string | null>(null)
  const scale = zoom.imageId === props.image.id ? zoom.scale : 1
  const dimensions =
    loaded?.imageId === props.image.id ? loaded.dimensions : null
  const failed = failedId === props.image.id
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useEffect(() => {
    if (!dimensions) return
    const fit = () => {
      void transform.current?.fitToView({ maxScale: 1, animationTime: 0 })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [dimensions])
  const ready = Boolean(dimensions) && !failed
  return (
    <div
      className='studio-viewer'
      tabIndex={0}
      role='region'
      aria-label={t('Zoomable image')}
      aria-describedby='studio-viewer-help'
      onKeyDown={(event) => {
        if (event.ctrlKey || event.metaKey || event.altKey) return
        const controls = transform.current
        if (!controls) return
        let handled = true
        switch (event.key) {
          case '+':
          case '=':
            if (ready) void controls.zoomIn(0.3, 0)
            break
          case '-':
            if (ready) void controls.zoomOut(0.3, 0)
            break
          case '0':
            if (ready) {
              void controls.fitToView({ maxScale: 1, animationTime: 0 })
            }
            break
          case '1':
            if (ready) void controls.centerView(1, 0)
            break
          case 'ArrowLeft':
            if (event.shiftKey) void controls.panBy(80, 0, 0)
            else handled = false
            break
          case 'ArrowRight':
            if (event.shiftKey) void controls.panBy(-80, 0, 0)
            else handled = false
            break
          case 'ArrowUp':
            void controls.panBy(0, 80, 0)
            break
          case 'ArrowDown':
            void controls.panBy(0, -80, 0)
            break
          default:
            handled = false
        }
        if (handled) event.preventDefault()
      }}
    >
      <div
        className='studio-viewer-toolbar'
        aria-label={t('Image zoom controls')}
      >
        <Button
          size='icon'
          variant='outline'
          disabled={!ready || scale <= 0.005}
          aria-label={t('Zoom out')}
          onClick={() => void transform.current?.zoomOut(0.3, 0)}
        >
          <ZoomOut size={18} aria-hidden='true' />
        </Button>
        <output className='studio-zoom-value' aria-label={t('Zoom level')}>
          {formatNumber(Math.round(scale * 100), locale)}%
        </output>
        <Button
          size='icon'
          variant='outline'
          disabled={!ready || scale >= 4}
          aria-label={t('Zoom in')}
          onClick={() => void transform.current?.zoomIn(0.3, 0)}
        >
          <ZoomIn size={18} aria-hidden='true' />
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={!ready}
          onClick={() =>
            void transform.current?.fitToView({ maxScale: 1, animationTime: 0 })
          }
        >
          <Maximize2 size={15} aria-hidden='true' />
          {t('Fit to window')}
        </Button>
        <Button
          size='sm'
          variant='outline'
          disabled={!ready}
          onClick={() => void transform.current?.centerView(1, 0)}
        >
          {t('Original size')}
        </Button>
      </div>
      {failed ? (
        <ErrorState
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
            </Button>
          }
        />
      ) : (
        <TransformWrapper
          key={props.image.id}
          ref={transform}
          minScale={0.005}
          maxScale={4}
          centerOnInit
          doubleClick={{ disabled: true }}
          wheel={{ step: 0.15 }}
          panning={{ velocityDisabled: true }}
          onTransform={(_ref, state) =>
            setZoom({ imageId: props.image.id, scale: state.scale })
          }
        >
          <TransformComponent
            wrapperClass='studio-viewer-viewport'
            contentClass='studio-viewer-content'
            wrapperProps={{
              onDoubleClick: (event) => {
                if (!dimensions) return
                const fittedScale = Math.min(
                  1,
                  event.currentTarget.clientWidth / dimensions.width,
                  event.currentTarget.clientHeight / dimensions.height
                )
                if (scale <= fittedScale + 0.001) {
                  void transform.current?.centerView(
                    Math.max(1, fittedScale * 2),
                    0
                  )
                } else {
                  void transform.current?.fitToView({
                    maxScale: 1,
                    animationTime: 0,
                  })
                }
              },
              tabIndex: -1,
            }}
          >
            <img
              src={props.image.src}
              alt={t('Image Preview')}
              width={dimensions?.width}
              height={dimensions?.height}
              referrerPolicy='no-referrer'
              draggable={false}
              onError={() => setFailedId(props.image.id)}
              onLoad={(event) => {
                const image = event.currentTarget
                if (image.naturalWidth && image.naturalHeight) {
                  setLoaded({
                    imageId: props.image.id,
                    dimensions: {
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    },
                  })
                }
              }}
            />
          </TransformComponent>
        </TransformWrapper>
      )}
      <ImageSizeDetails
        dimensions={dimensions}
        requestedSize={props.requestedSize}
      />
      <p className='studio-viewer-help' id='studio-viewer-help'>
        {t(
          'Scroll or pinch to zoom, drag to move, double-click to toggle zoom. Keys: + / −, 0 to fit, 1 for original.'
        )}
      </p>
    </div>
  )
}

export function StudioPreview(props: {
  images: ImageOutput[]
  index: number
  onIndexChange: (index: number) => void
  onClose: () => void
  requestedSize?: string
  title?: string
  footer?: (image: ImageOutput) => ReactNode
}) {
  const { t } = useTranslation()
  const previewBody = useRef<HTMLDivElement>(null)
  const image = props.images[props.index]
  if (!image) return null
  const changeImage = (index: number) => {
    props.onIndexChange(index)
    window.requestAnimationFrame(() =>
      previewBody.current
        ?.querySelector<HTMLElement>('.studio-viewer')
        ?.focus({ preventScroll: true })
    )
  }
  const previous =
    props.index > 0 ? () => changeImage(props.index - 1) : undefined
  const next =
    props.index < props.images.length - 1
      ? () => changeImage(props.index + 1)
      : undefined
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={props.title ?? t('Image Preview')}
      description={t('View image details')}
      contentClassName='studio-preview-dialog sm:max-w-5xl'
      footerClassName='studio-preview-footer'
      footer={props.footer?.(image)}
    >
      <div
        ref={previewBody}
        onKeyDown={(event) => {
          if (
            event.shiftKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey
          ) {
            return
          }
          if (event.key === 'ArrowLeft' && previous) {
            event.preventDefault()
            previous()
          }
          if (event.key === 'ArrowRight' && next) {
            event.preventDefault()
            next()
          }
        }}
      >
        {props.images.length > 1 && (
          <div className='studio-preview-navigation'>
            <Button
              variant='outline'
              size='icon'
              aria-label={t('Previous image')}
              disabled={!previous}
              onClick={previous}
            >
              <ChevronLeft size={18} aria-hidden='true' />
            </Button>
            <span aria-live='polite'>
              {t('Image {{index}} of {{count}}', {
                index: props.index + 1,
                count: props.images.length,
              })}
            </span>
            <Button
              variant='outline'
              size='icon'
              aria-label={t('Next image')}
              disabled={!next}
              onClick={next}
            >
              <ChevronRight size={18} aria-hidden='true' />
            </Button>
          </div>
        )}
        <ZoomableImage image={image} requestedSize={props.requestedSize} />
        {image.revisedPrompt && (
          <div className='studio-result-prompt'>
            <strong>{t('Revised prompt')}</strong>
            <p>{image.revisedPrompt}</p>
            <CopyButton value={image.revisedPrompt} size='sm'>
              {t('Copy prompt')}
            </CopyButton>
          </div>
        )}
      </div>
    </Dialog>
  )
}
