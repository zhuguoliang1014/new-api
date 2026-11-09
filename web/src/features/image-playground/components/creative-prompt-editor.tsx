/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { ChevronDown, FileText } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Textarea } from '@/components/ui/textarea'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { editableCreativePrompt } from '../lib/creative'

export function CreativePromptEditor(props: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  limit?: number
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [open, setOpen] = useState(false)
  const id = useId()
  const value = editableCreativePrompt(props.value)
  const count = [...value].length
  const limit = props.limit ?? 32000
  const invalid = !value.trim() || count > limit
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className='creative-prompt-editor'
    >
      <div className='creative-prompt-heading'>
        <CollapsibleTrigger
          render={
            <Button variant='ghost' className='creative-prompt-trigger' />
          }
        >
          <span className='creative-prompt-icon'>
            <FileText size={17} />
          </span>
          <span className='creative-prompt-heading-text'>
            <strong>{t('Review & edit prompt')}</strong>
            <small>{t('Edit your creative description.')}</small>
          </span>
          <ChevronDown size={16} className={open ? 'is-expanded' : undefined} />
        </CollapsibleTrigger>
        <CopyButton
          value={value}
          size='sm'
          aria-label={t('Copy prompt')}
          tooltip={t('Copy prompt')}
        />
      </div>
      <CollapsibleContent>
        <div className='creative-prompt-content'>
          <Textarea
            id={id}
            aria-label={t('Generation prompt')}
            aria-describedby={`${id}-hint`}
            aria-invalid={invalid}
            disabled={props.disabled}
            rows={9}
            maxLength={Math.max(limit, value.length)}
            value={value}
            onChange={(e) => props.onChange(e.target.value)}
          />
          <div className='creative-prompt-meta' id={`${id}-hint`}>
            <span>{t('Changes apply to this generation.')}</span>
            <span className={invalid ? 'text-destructive' : undefined}>
              {formatNumber(count, locale)} / {formatNumber(limit, locale)}
            </span>
          </div>
          {invalid && (
            <p role='status' className='studio-field-error'>
              {value.trim()
                ? t('Prompt is too long.')
                : t('Describe the image you want to create.')}
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
