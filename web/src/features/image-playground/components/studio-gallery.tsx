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
import { ImagePlus, Search } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'

import { getImageAuthScope } from '../api'
import { persistStudioRecord } from '../hooks/use-image-studio'
import { useImagePlaygroundStore } from '../store'
import type { ImageRecord } from '../types'
import { GenerationProgress } from './generation-progress'
import { StudioCreationActions } from './studio-creation-actions'
import { ImageArtwork, ImageActions } from './studio-image'
import { StudioInspiration } from './studio-inspiration'

const StudioPreview = lazy(() =>
  import('./studio-preview').then((module) => ({
    default: module.StudioPreview,
  }))
)

export function StudioGallery() {
  const { t, i18n } = useTranslation()
  const taskSyncError = useImagePlaygroundStore((state) => state.taskSyncError)
  const records = useImagePlaygroundStore((state) => state.records)
  const jobs = useImagePlaygroundStore((state) => state.jobs)
  const storageUnavailable = useImagePlaygroundStore(
    (state) => state.storageUnavailable
  )
  const [preview, setPreview] = useState<{
    index: number
    record: ImageRecord
  } | null>(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const previewRecord =
    records.find((item) => item.id === preview?.record.id) ?? preview?.record
  const search = query.trim().toLowerCase()
  const visibleRecords =
    filter === 'running'
      ? []
      : records.filter((item) =>
          `${item.parameters.prompt} ${item.parameters.model}`
            .toLowerCase()
            .includes(search)
        )
  const visibleJobs =
    filter === 'completed'
      ? []
      : jobs.filter((item) =>
          `${item.parameters.prompt} ${item.parameters.model}`
            .toLowerCase()
            .includes(search)
        )
  const activeCount = jobs.filter((job) => !job.error).length
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  return (
    <section className='studio-gallery' aria-label={t('My creations')}>
      <div className='studio-gallery-toolbar'>
        <div
          className='studio-gallery-tabs'
          role='group'
          aria-label={t('Filter creations')}
        >
          <Button
            variant='ghost'
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            {t('My creations')}
            <span>{records.length + jobs.length}</span>
          </Button>
          <Button
            variant='ghost'
            aria-pressed={filter === 'running'}
            onClick={() => setFilter('running')}
          >
            {t('Tasks')}
            <span>{jobs.length}</span>
          </Button>
          <Button
            variant='ghost'
            aria-pressed={filter === 'completed'}
            onClick={() => setFilter('completed')}
          >
            {t('Completed')}
          </Button>
        </div>
        <div className='studio-history-search'>
          <Search size={15} aria-hidden='true' />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search creations')}
            aria-label={t('Search creations')}
          />
        </div>
      </div>
      <div className='studio-canvas'>
        {taskSyncError && (
          <p className='studio-storage-warning' role='status'>
            {t('Connection interrupted. Tasks continue on the server.')}
          </p>
        )}
        {storageUnavailable && (
          <p className='studio-storage-warning' role='status'>
            {t(
              'Local storage is unavailable or full. Download your images before leaving.'
            )}
          </p>
        )}
        {activeCount > 0 && (
          <p className='studio-running-note' role='status'>
            <span />
            {t('{{count}} tasks running · keep creating', {
              count: activeCount,
            })}
          </p>
        )}
        {!visibleRecords.length &&
          !visibleJobs.length &&
          (search || filter !== 'all' ? (
            <EmptyState
              icon={ImagePlus}
              title={t('No results found')}
              className='studio-empty'
            />
          ) : (
            <StudioInspiration />
          ))}
        <div className='studio-creations-grid'>
          {visibleJobs.map((job) => (
            <GenerationProgress key={job.id} job={job} />
          ))}
          {visibleRecords.map((record) => (
            <article key={record.id} className='studio-result-card'>
              <div
                className={`studio-results-grid${record.images.length === 1 ? ' studio-results-single' : ''}`}
              >
                {record.images.map((image, index) => (
                  <div key={image.id} className='studio-result-image'>
                    <ImageArtwork
                      image={image}
                      requestedSize={record.parameters.size}
                      onPreview={() => setPreview({ index, record })}
                    />
                  </div>
                ))}
              </div>
              <div className='studio-card-details'>
                <p className='studio-card-prompt'>{record.parameters.prompt}</p>
                <div className='studio-card-meta'>
                  <span>{record.parameters.model}</span>
                  <span>
                    {record.parameters.size === 'auto'
                      ? t('Auto')
                      : record.parameters.size.replace('x', ' × ')}
                  </span>
                  <time>
                    {new Date(record.createdAt).toLocaleTimeString(locale, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
                {record.localSaveStatus === 'saving' && (
                  <p className='studio-field-hint' role='status'>
                    {t('Saving images locally...')}
                    {record.cacheProgress &&
                      ` ${(record.cacheProgress.loaded / 1048576).toFixed(1)} MB${record.cacheProgress.total ? ` / ${(record.cacheProgress.total / 1048576).toFixed(1)} MB · ${Math.min(100, Math.floor((record.cacheProgress.loaded * 100) / record.cacheProgress.total))}%` : ''}`}
                  </p>
                )}
                {record.localSaveStatus === 'failed' && (
                  <p className='studio-field-error' role='status'>
                    {t(
                      'Some images could not be saved locally. Download them before their links expire.'
                    )}
                  </p>
                )}
                {record.localSaveStatus === 'failed' && (
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      const scope = getImageAuthScope()
                      if (!scope) return
                      useImagePlaygroundStore.setState((state) => ({
                        records: state.records.map((item) =>
                          item.id === record.id
                            ? { ...item, localSaveStatus: 'saving' }
                            : item
                        ),
                      }))
                      void persistStudioRecord(
                        record,
                        scope,
                        new AbortController().signal
                      )
                    }}
                  >
                    {t('Retry download')}
                  </Button>
                )}
                <StudioCreationActions record={record} />
              </div>
            </article>
          ))}
        </div>
      </div>
      {preview && previewRecord && (
        <Suspense fallback={<LoadingState />}>
          <StudioPreview
            images={previewRecord.images}
            index={preview.index}
            requestedSize={previewRecord.parameters.size}
            prompt={previewRecord.parameters.prompt}
            onClose={() => setPreview(null)}
            onIndexChange={(index) =>
              setPreview((current) => (current ? { ...current, index } : null))
            }
            footer={(image) => (
              <ImageActions
                image={image}
                record={previewRecord}
                onReferenceUsed={() => setPreview(null)}
              />
            )}
          />
        </Suspense>
      )}
    </section>
  )
}
