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
import { Search } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { useImagePlaygroundStore } from '../store'
import type { ImageRecord } from '../types'
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
  const storageUnavailable = useImagePlaygroundStore(
    (state) => state.storageUnavailable
  )
  const [preview, setPreview] = useState<{
    index: number
    record: ImageRecord
  } | null>(null)
  const [historyQuery, setHistoryQuery] = useState('')
  const record = records.find((item) => item.id === selectedId) ?? records[0]
  const visibleRecords = historyQuery.trim()
    ? records.filter((item) => {
        const query = historyQuery.trim().toLowerCase()
        return (
          item.parameters.prompt.toLowerCase().includes(query) ||
          item.parameters.model.toLowerCase().includes(query)
        )
      })
    : records
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <section className='studio-gallery' aria-label={t('My creations')}>
      <div className='studio-canvas'>
        {storageUnavailable && (
          <p className='studio-storage-warning' role='status'>
            {t(
              'Local storage is unavailable or full. Download your images before leaving.'
            )}
          </p>
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
                </div>
              ))}
            </div>
            {record.images.some((image) => /^https?:/.test(image.src)) && (
              <p className='studio-help'>
                {t(
                  'Some providers return temporary links. Download images you want to keep.'
                )}
              </p>
            )}
          </div>
        )}
      </div>
      {records.length > 0 && (
        <div className='studio-history'>
          <h3>
            {t('Recent creations')}
            <span>{formatNumber(records.length, locale)}</span>
          </h3>
          <label className='studio-history-search'>
            <Search size={14} aria-hidden='true' />
            <Input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder={t('Search')}
              aria-label={t('Search')}
            />
          </label>
          <div className='studio-history-list'>
            {visibleRecords.map((item, index) => (
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
            {!visibleRecords.length && (
              <p className='studio-history-empty'>{t('No results found')}</p>
            )}
          </div>
        </div>
      )}
      {preview && (
        <Suspense fallback={<LoadingState />}>
          <StudioPreview
            images={preview.record.images}
            index={preview.index}
            requestedSize={preview.record.parameters.size}
            prompt={preview.record.parameters.prompt}
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
    </section>
  )
}
