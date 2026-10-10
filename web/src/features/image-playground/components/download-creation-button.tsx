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
import { Download, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

import { downloadImagesArchive } from '../lib/images'
import type { ImageRecord } from '../types'

export function DownloadCreationButton(props: { record: ImageRecord }) {
  const { t } = useTranslation()
  const [working, setWorking] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const download = async () => {
    if (controller.current) return
    const downloadController = new AbortController()
    controller.current = downloadController
    setWorking(true)
    try {
      await downloadImagesArchive(
        props.record.images,
        props.record.id,
        downloadController.signal
      )
    } catch (error) {
      if (!downloadController.signal.aborted) handleServerError(error)
    } finally {
      if (!downloadController.signal.aborted) setWorking(false)
      controller.current = null
    }
  }
  return (
    <Button
      variant='ghost'
      size='sm'
      disabled={working}
      onClick={() => void download()}
    >
      {working ? (
        <Loader2
          size={15}
          className='animate-spin motion-reduce:animate-none'
          aria-hidden='true'
        />
      ) : (
        <Download size={15} aria-hidden='true' />
      )}
      {working ? t('Preparing download...') : t('Download all (ZIP)')}
    </Button>
  )
}
