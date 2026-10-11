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
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { useImagePlaygroundStore } from '../store'

export function GenerationProgress(props: { compact: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const job = useImagePlaygroundStore((state) => state.job)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!job) return
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - job.startedAt) / 1000)),
      1000
    )
    return () => window.clearInterval(timer)
  }, [job])
  if (!job) return null
  return (
    <div
      className={
        props.compact
          ? 'studio-progress studio-progress-compact'
          : 'studio-progress'
      }
    >
      <div className='studio-progress-art' aria-hidden='true'>
        <div className='studio-progress-dots'>
          <span />
          <span />
          <span />
        </div>
      </div>
      <div role='status'>
        <span className='studio-eyebrow'>{t('Creation in progress')}</span>
        <h2>{t('Turning your idea into an image.')}</h2>
        <p>
          {t(
            'You can visit other pages while we work. Keep this browser tab open.'
          )}
        </p>
        <p className='studio-progress-time'>
          {t('{{seconds}}s elapsed', {
            seconds: formatNumber(elapsed, locale),
          })}{' '}
          · {job.parameters.model}
        </p>
      </div>
      <small>
        {t('Stopping may not cancel processing or charges at the provider.')}
      </small>
    </div>
  )
}
