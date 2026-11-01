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
import { Clock3, Loader2, RotateCcw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'

import { deleteStudioTask, retryStudioDownload } from '../api'
import { useImagePlaygroundStore } from '../store'
import type { ImageJob } from '../types'

export function GenerationProgress(props: { job: ImageJob }) {
  const { t, i18n } = useTranslation()
  const job = props.job
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (job.error) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [job.error])
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  let statusLabel = t('Creating...')
  if (job.error) {
    statusLabel = t('Creation interrupted')
  } else if (job.status === 'submitting') {
    statusLabel = t('Submitting task...')
  } else if (job.status === 'queued') {
    statusLabel = t('Queued')
  } else if (job.status === 'downloading') {
    statusLabel = t('Receiving image on server...')
  }
  return (
    <article
      className={`studio-job-card${job.error ? ' studio-job-failed' : ''}`}
    >
      <div className='studio-job-top'>
        <span>{statusLabel}</span>
        {(!job.serverTask || job.error) && (
          <Button
            type='button'
            variant='ghost'
            size='icon'
            aria-label={job.error ? t('Dismiss') : t('Stop waiting')}
            onClick={() => {
              if (job.serverTask) {
                void deleteStudioTask(job.id)
                  .then(() =>
                    useImagePlaygroundStore.setState((state) => ({
                      jobs: state.jobs.filter((item) => item.id !== job.id),
                    }))
                  )
                  .catch(handleServerError)
                return
              }
              if (job.error) {
                useImagePlaygroundStore.setState((state) => ({
                  jobs: state.jobs.filter((item) => item.id !== job.id),
                }))
              } else job.controller.abort()
            }}
          >
            <X size={15} />
          </Button>
        )}
      </div>
      <div className='studio-job-visual' aria-hidden='true'>
        {job.error ? (
          <RotateCcw size={28} />
        ) : (
          <Loader2
            size={28}
            className='animate-spin motion-reduce:animate-none'
          />
        )}
      </div>
      <p className='studio-card-prompt'>{job.parameters.prompt}</p>
      <div className='studio-card-meta'>
        <span>{job.parameters.model}</span>
        <span>
          {job.parameters.size === 'auto'
            ? t('Auto')
            : job.parameters.size.replace('x', ' × ')}
        </span>
      </div>
      {job.serverTask && (
        <p className='studio-field-hint'>
          {t('Task ID')}: <code className='break-all'>{job.id}</code>
        </p>
      )}
      {job.status === 'downloading' && (job.downloadImageIndex ?? 0) > 0 && (
        <p className='studio-field-hint'>
          {job.downloadImageIndex} / {job.parameters.count}
        </p>
      )}
      {job.status === 'downloading' && (
        <p className='studio-field-hint' role='status'>
          {t('Downloaded {{loaded}} MB{{total}}', {
            loaded: ((job.downloadedBytes ?? 0) / 1048576).toFixed(1),
            total: job.totalBytes
              ? ` / ${(job.totalBytes / 1048576).toFixed(1)} MB · ${Math.min(100, Math.floor(((job.downloadedBytes ?? 0) * 100) / job.totalBytes))}%`
              : '',
          })}
        </p>
      )}
      {job.serverTask && !job.error && (
        <p className='studio-field-hint'>
          {t('Safe to refresh. Images stay on the server for 10 hours.')}
        </p>
      )}
      {job.error ? (
        <>
          <p className='studio-field-error' role='alert'>
            {job.error}
          </p>
          {job.status === 'download_failed' && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() =>
                void retryStudioDownload(job.id).catch(handleServerError)
              }
            >
              {t('Retry download')}
            </Button>
          )}
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() =>
              useImagePlaygroundStore.getState().setParameters(job.parameters)
            }
          >
            {t('Reuse settings')}
          </Button>
        </>
      ) : (
        <p className='studio-job-time' role='status'>
          <Clock3 size={13} />
          {t('{{seconds}}s elapsed', {
            seconds: formatNumber(
              Math.max(0, Math.floor((now - job.startedAt) / 1000)),
              locale
            ),
          })}
        </p>
      )}
    </article>
  )
}
