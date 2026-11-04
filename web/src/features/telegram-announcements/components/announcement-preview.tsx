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
import { ArrowUpRight, Send } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { HtmlContent } from '@/components/html-content'

import {
  renderAnnouncementMarkdown,
  sanitizeAnnouncementHTML,
} from '../lib/format'
import type { AnnouncementInput, AnnouncementTemplate } from '../types'

function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password) {
      return value
    }
  } catch {
    /* An incomplete template link stays inactive in the preview. */
  }
  return undefined
}

export function AnnouncementMessage(props: {
  input: AnnouncementInput
  template: AnnouncementTemplate
  username: string
  bodyHTML?: string
}) {
  const { t } = useTranslation()
  const body = useMemo(() => {
    if (props.bodyHTML !== undefined) {
      return sanitizeAnnouncementHTML(props.bodyHTML)
    }
    if (props.input.body_format === 'markdown') {
      return renderAnnouncementMarkdown(props.input.body)
    }
    return undefined
  }, [props.bodyHTML, props.input.body, props.input.body_format])
  const links = [
    {
      id: 'channel',
      label: props.template.channel_label,
      url: props.template.channel_url,
    },
    {
      id: 'contact',
      label: props.template.contact_label,
      url: props.template.contact_url,
    },
  ]
  return (
    <div className='min-w-0 space-y-2' aria-label={t('Announcement preview')}>
      <article className='bg-card text-card-foreground overflow-hidden rounded-2xl rounded-bl-sm border p-5 shadow-sm'>
        <p className='text-primary mb-3 flex items-center gap-2 text-sm font-semibold'>
          <Send className='size-4' aria-hidden='true' />
          {props.username ? `@${props.username}` : 'AiProxy'}
        </p>
        <h3 className='font-semibold [overflow-wrap:anywhere] break-words whitespace-pre-wrap'>
          {props.input.title.trim() || t('Announcement title')}
        </h3>
        {body !== undefined && props.input.body.trim() ? (
          <HtmlContent
            content={body}
            className='[&_a]:text-primary [&_blockquote]:text-muted-foreground [&_pre]:bg-muted mt-3 text-sm leading-7 [overflow-wrap:anywhere] whitespace-pre-wrap [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_code]:font-mono [&_code]:text-xs [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3'
          />
        ) : (
          <p className='mt-3 text-sm leading-7 [overflow-wrap:anywhere] break-words whitespace-pre-wrap'>
            {props.input.body.trim() ||
              t('Your announcement will appear here.')}
          </p>
        )}
        {props.template.footer && (
          <p className='mt-5 border-t pt-4 text-sm leading-6 break-words whitespace-pre-wrap'>
            {props.template.footer}
          </p>
        )}
      </article>
      {links.map((link) => (
        <a
          key={link.id}
          href={safeLink(link.url)}
          target='_blank'
          rel='noopener noreferrer'
          className='border-primary/15 bg-primary/10 text-primary hover:bg-primary/15 flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors'
        >
          {link.label}
          <ArrowUpRight className='size-4' aria-hidden='true' />
        </a>
      ))}
    </div>
  )
}
