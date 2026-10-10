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
import { Clock3, RotateCcw, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { getImageAuthScope } from '../api'
import { deleteImageRecord } from '../lib/history'
import { useImagePlaygroundStore } from '../store'
import type { ImageRecord } from '../types'
import { DownloadCreationButton } from './download-creation-button'
import { GenerationProgress } from './generation-progress'
import { ImageArtwork, ImageActions } from './studio-image'
import { StudioInspiration } from './studio-inspiration'

const StudioPreview = lazy(() =>
  import('./studio-preview').then((module) => ({
    default: module.StudioPreview,
  }))
)

export function StudioGallery() {
  const { t, i18n } = useTranslation()
  const records = useImagePlaygroundStore((state) => state.records)
  const selectedId = useImagePlaygroundStore((state) => state.selectedRecordId)
  const job = useImagePlaygroundStore((state) => state.job)
  const error = useImagePlaygroundStore((state) => state.error)
  const storageUnavailable = useImagePlaygroundStore(
    (state) => state.storageUnavailable
  )
  const [preview, setPreview] = useState<{
    index: number
    record: ImageRecord
  } | null>(null)
  const [deleting, setDeleting] = useState<ImageRecord | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const record = records.find((item) => item.id === selectedId) ?? records[0]
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useEffect(() => {
    if (selectedId) {
      document
        .querySelector('.studio-result')
        ?.scrollIntoView({ block: 'start' })
    }
  }, [selectedId])
  const remove = async () => {
    if (!deleting) return
    const scope = getImageAuthScope()
    setDeleteBusy(true)
    try {
      await deleteImageRecord(deleting.ownerId, deleting.id)
      if (scope !== getImageAuthScope()) return
      useImagePlaygroundStore.setState((state) => ({
        records: state.records.filter((item) => item.id !== deleting.id),
        selectedRecordId: null,
      }))
      setDeleting(null)
    } catch (err) {
      handleServerError(err)
    } finally {
      setDeleteBusy(false)
    }
  }
  return (
    <section className='studio-gallery' aria-label={t('My creations')}>
      <div className='studio-gallery-header'>
        <div>
          <span className='studio-step'>02</span>
          <h2>
            {t('My creations')}
            <span className='studio-count'>
              {formatNumber(records.length, locale)}
            </span>
          </h2>
        </div>
        <span className='studio-local-label'>
          <Clock3 size={14} aria-hidden='true' />
          {t('Saved in this browser')}
        </span>
      </div>
      {storageUnavailable && (
        <p className='studio-storage-warning' role='status'>
          {t(
            'Local storage is unavailable or full. Download your images before leaving.'
          )}
        </p>
      )}
      {error && (
        <div className='studio-generation-error' role='alert'>
          <strong>{t('Creation interrupted')}</strong>
          <p>{error}</p>
          <Button
            variant='outline'
            size='sm'
            onClick={() => {
              useImagePlaygroundStore.setState({ error: null })
              document
                .querySelector<HTMLTextAreaElement>('#studio-prompt')
                ?.focus()
            }}
          >
            {t('Review and try again')}
          </Button>
        </div>
      )}
      {job && <GenerationProgress compact={Boolean(selectedId)} />}
      {!job && !record && <StudioInspiration />}
      {(!job || selectedId) && record && (
        <div className='studio-result'>
          <div className='studio-result-meta'>
            <span>
              {record.parameters.model} ·{' '}
              {record.parameters.size === 'auto'
                ? t('Auto')
                : record.parameters.size.replace('x', ' × ')}
            </span>
            <span>
              {new Date(record.createdAt).toLocaleString(locale, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div
            className={`studio-results-grid${record.images.length === 1 ? ' studio-results-single' : ''}`}
          >
            {record.images.map((image, index) => (
              <div className='studio-result-card' key={image.id}>
                <ImageArtwork
                  image={image}
                  requestedSize={record.parameters.size}
                  onPreview={() => setPreview({ index, record })}
                />
                <ImageActions image={image} record={record} />
              </div>
            ))}
          </div>
          <div className='studio-result-prompt'>
            <p>{record.parameters.prompt}</p>
            <div className='studio-result-tools'>
              {record.images.length > 1 && (
                <DownloadCreationButton key={record.id} record={record} />
              )}
              <CopyButton
                value={record.parameters.prompt}
                size='sm'
                variant='ghost'
                aria-label={t('Copy prompt')}
              >
                {t('Copy prompt')}
              </CopyButton>
              <Button
                variant='ghost'
                size='sm'
                disabled={Boolean(job)}
                onClick={() => {
                  useImagePlaygroundStore.getState().reuseRecord(record)
                  document
                    .querySelector<HTMLTextAreaElement>('#studio-prompt')
                    ?.focus()
                  document
                    .querySelector<HTMLTextAreaElement>('#studio-prompt')
                    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                }}
              >
                <RotateCcw size={14} aria-hidden='true' />
                {t('Reuse settings')}
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className='studio-delete'
                aria-label={t('Delete creation')}
                onClick={() => setDeleting(record)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          {record.referenceCount > 0 && (
            <p className='studio-help'>
              {t(
                'This creation used {{count}} reference image(s). Add references again to regenerate.',
                { count: record.referenceCount }
              )}
            </p>
          )}
          {record.images.some((image) => /^https?:/.test(image.src)) && (
            <p className='studio-help'>
              {t(
                'Some providers return temporary links. Download images you want to keep.'
              )}
            </p>
          )}
        </div>
      )}
      {records.length > 0 && (
        <div className='studio-history'>
          <h3>
            {t('Recent creations')}
            <span>{t('Last 30 creations are kept locally')}</span>
          </h3>
          <div className='studio-history-list'>
            {records.map((item, index) => (
              <Button
                key={item.id}
                variant='ghost'
                className='studio-history-item'
                aria-pressed={
                  item.id === record?.id && (!job || Boolean(selectedId))
                }
                aria-label={t('View creation {{index}}', { index: index + 1 })}
                onClick={() =>
                  useImagePlaygroundStore.setState({
                    selectedRecordId: item.id,
                  })
                }
              >
                <img
                  src={item.images[0].src}
                  alt=''
                  loading='lazy'
                  referrerPolicy='no-referrer'
                />
                <span>{item.parameters.prompt}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      {preview && (
        <Suspense fallback={<LoadingState />}>
          <StudioPreview
            images={preview.record.images}
            index={preview.index}
            requestedSize={preview.record.parameters.size}
            onClose={() => setPreview(null)}
            onIndexChange={(index) =>
              setPreview((current) => (current ? { ...current, index } : null))
            }
            footer={(image) => (
              <ImageActions
                image={image}
                record={preview.record}
                onReferenceUsed={() => setPreview(null)}
              />
            )}
          />
        </Suspense>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={t('Delete creation?')}
        desc={t(
          'This removes the images and prompt from this browser. Download anything you want to keep first.'
        )}
        confirmText={t('Delete')}
        destructive
        isLoading={deleteBusy}
        handleConfirm={() => void remove()}
      />
    </section>
  )
}
