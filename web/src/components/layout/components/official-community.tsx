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
import { ArrowUpRight, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { IconTelegram } from '@/assets/brand-icons/icon-telegram'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

const TELEGRAM_BOT_USERNAME = '@aiproxy92_bot'
const TELEGRAM_BOT_URL = 'https://t.me/aiproxy92_bot'

export function OfficialCommunity() {
  const { t } = useTranslation()

  return (
    <Dialog
      trigger={
        <Button
          variant='ghost'
          size='sm'
          className='h-8 gap-1.5 border border-emerald-200 bg-emerald-50 px-2 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 sm:px-3 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900 dark:hover:text-emerald-100'
          aria-label={t('Official Community')}
          title={t('Official Community')}
        >
          <Users className='size-4' aria-hidden='true' />
          <span className='hidden sm:inline'>{t('Official Community')}</span>
        </Button>
      }
      title={t('Join the official community')}
      description={t(
        'Message our Telegram bot and send your order number to get a community invitation.'
      )}
      contentClassName='gap-5 rounded-3xl p-6 shadow-xl sm:max-w-[480px] sm:p-8'
      headerClassName='gap-3 pr-4'
      titleClassName='text-2xl leading-tight font-semibold tracking-tight'
      descriptionClassName='text-sm leading-6'
      bodyClassName='space-y-5'
    >
      <div className='flex min-w-0 items-center gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950'>
        <div className='flex size-12 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white shadow-sm'>
          <IconTelegram className='size-7' aria-hidden='true' />
        </div>
        <div className='min-w-0 flex-1 space-y-1'>
          <p className='text-muted-foreground text-xs font-medium'>
            {t('Telegram bot')}
          </p>
          <p className='truncate text-base font-semibold tracking-tight sm:text-lg'>
            {TELEGRAM_BOT_USERNAME}
          </p>
        </div>
        <CopyButton value={TELEGRAM_BOT_USERNAME} className='size-8' notify />
      </div>

      <div className='space-y-3'>
        <Button
          nativeButton={false}
          role='link'
          className='h-11 w-full gap-2 rounded-xl bg-sky-600 text-white hover:bg-sky-700'
          render={
            <a
              href={TELEGRAM_BOT_URL}
              target='_blank'
              rel='noopener noreferrer'
            />
          }
        >
          {t('Open Telegram')}
          <ArrowUpRight className='size-4' aria-hidden='true' />
        </Button>
        <p className='text-muted-foreground text-center text-xs leading-5'>
          {t('You can also search for this username in Telegram.')}
        </p>
      </div>
    </Dialog>
  )
}
