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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import { previewAnnouncement, publishAnnouncement } from '../api'
import type { AnnouncementPreview } from '../types'

export function useAnnouncementPublisher(onPublished: () => void) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [confirmation, setConfirmation] = useState<{
    preview: AnnouncementPreview
    id: string
  } | null>(null)
  const preview = useMutation({
    mutationFn: previewAnnouncement,
    onSuccess: (result) =>
      setConfirmation({ preview: result, id: crypto.randomUUID() }),
    onError: (error) => handleServerError(error),
  })
  const publish = useMutation({
    mutationFn: publishAnnouncement,
    retry: false,
    onSuccess: (record) => {
      void queryClient.invalidateQueries({
        queryKey: ['telegram-announcements', 'history'],
      })
      setConfirmation(null)
      const allSent =
        record.status === 'sent' &&
        (!record.channel_requested || record.channel_status === 'sent')
      const channelOnly =
        record.channel_requested && record.chat_id === record.channel_chat_id
      if (record.channel_requested && !allSent && !channelOnly) {
        toast.warning(
          t(
            'Group and channel delivery results differ. Check publication history before publishing again.'
          )
        )
        return
      }
      if (record.status === 'sent') {
        toast.success(t('Announcement published'))
        if (record.pin_requested && record.pin_status !== 'pinned') {
          toast.warning(
            t('Published, but could not pin. Check bot permissions.')
          )
        }
        onPublished()
      } else if (record.status === 'failed') {
        toast.error(
          t(
            'Telegram rejected the announcement. Check bot permissions and message content.'
          )
        )
      } else {
        toast.warning(
          t('Delivery is unconfirmed. Check Telegram before publishing again.')
        )
      }
    },
    onError: (error) => {
      // Keep the same ID for a retry; the server never sends that ID twice.
      void queryClient.invalidateQueries({
        queryKey: ['telegram-announcements', 'history'],
      })
      handleServerError(
        error,
        t('Delivery is unconfirmed. Check Telegram before publishing again.')
      )
    },
  })
  return { confirmation, setConfirmation, preview, publish }
}
