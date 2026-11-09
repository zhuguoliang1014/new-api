/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { ImageOff } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@/components/ui/skeleton'

/** Reserves image space and distinguishes loading from a failed reference. */
export function ReferenceThumbnail(props: {
  src: string
  alt: string
  lazy?: boolean
  compact?: boolean
}) {
  return <ReferenceThumbnailContent key={props.src} {...props} />
}
function ReferenceThumbnailContent(props: {
  src: string
  alt: string
  lazy?: boolean
  compact?: boolean
}) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  return (
    <span
      className={`reference-thumbnail${props.compact ? ' is-compact' : ''}`}
    >
      {status === 'loading' && (
        <Skeleton className='reference-thumbnail-skeleton' aria-hidden='true' />
      )}
      {status !== 'error' && (
        <img
          src={props.src}
          alt={props.alt}
          loading={props.lazy ? 'lazy' : undefined}
          decoding='async'
          referrerPolicy='no-referrer'
          className={status === 'ready' ? 'is-ready' : undefined}
          onLoad={() => setStatus('ready')}
          onError={() => setStatus('error')}
        />
      )}
      {status === 'error' && (
        <span
          className='reference-thumbnail-error'
          role='img'
          aria-label={`${props.alt} · ${t('Image unavailable')}`}
        >
          <ImageOff size={20} strokeWidth={1.5} aria-hidden='true' />
          {!props.compact && <small>{t('Image unavailable')}</small>}
        </span>
      )}
    </span>
  )
}
