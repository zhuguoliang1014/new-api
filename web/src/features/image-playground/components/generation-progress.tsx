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
  return (
    <article
      className={`studio-job-card${job.error ? ' studio-job-failed' : ''}`}
    >
      <div className='studio-job-top'>
        <span>{job.error ? t('Creation interrupted') : t('Creating...')}</span>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          aria-label={job.error ? t('Dismiss') : t('Stop waiting')}
          onClick={() => {
            if (job.error) {
              useImagePlaygroundStore.setState((state) => ({
                jobs: state.jobs.filter((item) => item.id !== job.id),
              }))
            } else job.controller.abort()
          }}
        >
          <X size={15} />
        </Button>
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
      {job.error ? (
        <>
          <p className='studio-field-error' role='alert'>
            {job.error}
          </p>
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
