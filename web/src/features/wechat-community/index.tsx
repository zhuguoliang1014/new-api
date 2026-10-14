/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { useTranslation } from 'react-i18next'

import { IconWeChat } from '@/assets/brand-icons/icon-wechat'
import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'

const WECHAT_ID = 'ls587657'

export function WeChatCommunity() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout hideHeader>
      <SectionPageLayout.Content>
        <section className='mx-auto grid w-full max-w-5xl items-center gap-8 px-2 py-10 sm:gap-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:py-24'>
          <div className='min-w-0'>
            <div className='text-muted-foreground mb-5 flex items-center gap-2 text-sm font-medium'>
              <IconWeChat aria-hidden='true' className='size-5' />
              {t('WeChat Community')}
            </div>
            <h1 className='text-foreground text-3xl leading-tight font-semibold tracking-tight sm:text-4xl'>
              {t('Contact support on WeChat')}
            </h1>
            <p className='text-muted-foreground mt-5 max-w-md text-base leading-8'>
              {t(
                'Add our support account for API setup help, issue reports, or a community invitation.'
              )}
            </p>
          </div>

          <Card className='w-full min-w-0 gap-6 rounded-2xl pt-6 sm:pt-8'>
            <CardHeader className='px-6 sm:px-8'>
              <h2 className='text-muted-foreground text-sm font-medium'>
                {t('Customer service WeChat ID')}
              </h2>
            </CardHeader>
            <CardContent className='flex flex-col gap-6 px-6 sm:px-8'>
              <p className='text-foreground font-mono text-3xl font-semibold tracking-wide select-all sm:text-4xl'>
                {WECHAT_ID}
              </p>
              <CopyButton
                value={WECHAT_ID}
                size='lg'
                variant='default'
                className='w-full'
                tooltip={t('Copy WeChat ID')}
              >
                {t('Copy WeChat ID')}
              </CopyButton>
              <p className='text-muted-foreground text-sm leading-6'>
                {t('In WeChat, open Add Contacts and search for the ID above.')}
              </p>
            </CardContent>
            <CardFooter className='px-6 py-5 sm:px-8'>
              <p className='text-muted-foreground text-sm leading-6'>
                {t(
                  'Include your question or a request to join the community when adding us.'
                )}
              </p>
            </CardFooter>
          </Card>
        </section>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
