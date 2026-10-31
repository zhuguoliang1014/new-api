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
import { FileText, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { CopyButton } from '@/components/copy-button'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import { handleServerError } from '@/lib/handle-server-error'

import { getImageAuthScope } from '../api'
import { deleteImageRecord } from '../lib/history'
import { useImagePlaygroundStore } from '../store'
import type { ImageRecord } from '../types'
import { DownloadCreationButton } from './download-creation-button'
import { ImageActions } from './studio-image'

export function StudioCreationActions() {
  const { t } = useTranslation()
  const record = useImagePlaygroundStore(
    (state) =>
      state.records.find((item) => item.id === state.selectedRecordId) ??
      state.records[0]
  )
  const selectedId = useImagePlaygroundStore((state) => state.selectedRecordId)
  const busy = useImagePlaygroundStore((state) => Boolean(state.job))
  const error = useImagePlaygroundStore((state) => state.error)
  const [deleting, setDeleting] = useState<ImageRecord | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const remove = async () => {
    if (!deleting) return
    const scope = getImageAuthScope()
    setDeleteBusy(true)
    try {
      await deleteImageRecord(deleting.ownerId, deleting.id)
      if (scope !== getImageAuthScope()) return
      useImagePlaygroundStore.setState((state) => ({
        records: state.records.filter((item) => item.id !== deleting.id),
        selectedRecordId:
          state.selectedRecordId === deleting.id
            ? null
            : state.selectedRecordId,
      }))
      setDeleting(null)
    } catch (err) {
      handleServerError(err)
    } finally {
      setDeleteBusy(false)
    }
  }
  return (
    <>
      {error && (
        <div className='studio-generation-error' role='alert'>
          <strong>{t('Creation interrupted')}</strong>
          <p>{error}</p>
          <Button
            type='button'
            variant='ghost'
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
      {record && (!busy || selectedId) && (
        <div
          className='studio-creation-actions'
          aria-label={t('My creations')}
          role='group'
        >
          <ImageActions image={record.images[0]} record={record} />
          {record.images.length > 1 && (
            <DownloadCreationButton key={record.id} record={record} />
          )}
          <Popover>
            <PopoverTrigger
              render={<Button type='button' variant='ghost' size='sm' />}
            >
              <FileText size={14} aria-hidden='true' />
              {t('Image prompt')}
            </PopoverTrigger>
            <PopoverContent side='top' className='studio-settings-popover'>
              <PopoverTitle>{t('Image prompt')}</PopoverTitle>
              <p className='studio-saved-prompt'>{record.parameters.prompt}</p>
              <CopyButton
                value={record.parameters.prompt}
                size='sm'
                variant='ghost'
                aria-label={t('Copy prompt')}
              >
                {t('Copy prompt')}
              </CopyButton>
              {record.referenceCount > 0 && (
                <p className='studio-help'>
                  {t(
                    'This creation used {{count}} reference image(s). Add references again to regenerate.',
                    { count: record.referenceCount }
                  )}
                </p>
              )}
            </PopoverContent>
          </Popover>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={busy}
            onClick={() => {
              useImagePlaygroundStore.getState().reuseRecord(record)
              document
                .querySelector<HTMLTextAreaElement>('#studio-prompt')
                ?.focus()
            }}
          >
            <RotateCcw size={14} aria-hidden='true' />
            {t('Reuse settings')}
          </Button>
          <Button
            type='button'
            variant='ghost'
            size='icon'
            className='studio-delete'
            aria-label={t('Delete creation')}
            disabled={busy || record.localSaveStatus === 'saving'}
            onClick={() => setDeleting(record)}
          >
            <Trash2 size={14} aria-hidden='true' />
          </Button>
        </div>
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
    </>
  )
}
