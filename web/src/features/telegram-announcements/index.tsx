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
import { useQuery } from '@tanstack/react-query'
import { Send } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { getAnnouncementConfig } from './api'
import { AnnouncementComposer } from './components/announcement-composer'
import { AnnouncementHistory } from './components/announcement-history'
import { TemplateSettings } from './components/template-settings'

export function TelegramAnnouncements() {
  const { t } = useTranslation()
  const config = useQuery({
    queryKey: ['telegram-announcements', 'config'],
    queryFn: getAnnouncementConfig,
  })
  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>
        {t('Telegram Announcements')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Badge variant='outline'>
          <Send className='mr-1.5 size-3.5' aria-hidden='true' />
          {config.data?.connected
            ? `@${config.data.bot_username}`
            : t('Bot not connected')}
        </Badge>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {config.isLoading && <LoadingState />}
        {config.isError && (
          <ErrorState
            onRetry={() => {
              void config.refetch()
            }}
          />
        )}
        {config.data && (
          <Tabs defaultValue='compose' className='min-w-0 gap-5'>
            <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
              <TabsTrigger value='compose'>
                {t('Write announcement')}
              </TabsTrigger>
              <TabsTrigger value='history'>
                {t('Publication history')}
              </TabsTrigger>
              <TabsTrigger value='template'>
                {t('Announcement template')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value='compose' keepMounted>
              <AnnouncementComposer config={config.data} />
            </TabsContent>
            <TabsContent value='history'>
              <AnnouncementHistory />
            </TabsContent>
            <TabsContent value='template'>
              <TemplateSettings config={config.data} />
            </TabsContent>
          </Tabs>
        )}
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
