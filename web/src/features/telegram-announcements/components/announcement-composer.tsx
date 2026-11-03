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
import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, Send } from 'lucide-react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { useAnnouncementPublisher } from '../hooks/use-announcement-publisher'
import { announcementSchema } from '../lib/schema'
import type { AnnouncementConfig, AnnouncementInput } from '../types'
import { AnnouncementMessage } from './announcement-preview'

export function AnnouncementComposer(props: { config: AnnouncementConfig }) {
  const { t } = useTranslation()
  const form = useForm<AnnouncementInput>({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      title: '',
      body: '',
      pin: false,
      publish_to_channel: false,
    },
  })
  const values = useWatch({ control: form.control })
  const input = {
    title: values.title ?? '',
    body: values.body ?? '',
    pin: values.pin ?? false,
    publish_to_channel: values.publish_to_channel ?? false,
  }
  const { confirmation, setConfirmation, preview, publish } =
    useAnnouncementPublisher(() => form.reset())
  return (
    <>
      <div className='grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]'>
        <Card className='min-w-0'>
          <CardHeader>
            <CardTitle>{t('Write announcement')}</CardTitle>
            <CardDescription>
              {t('The saved footer and link buttons are added automatically.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={form.handleSubmit((data) => preview.mutate(data))}
              className='space-y-5'
            >
              <div className='space-y-2'>
                <Label htmlFor='announcement-title'>
                  {t('Announcement title')}
                </Label>
                <Input
                  id='announcement-title'
                  {...form.register('title')}
                  aria-invalid={Boolean(form.formState.errors.title)}
                  aria-describedby='announcement-title-error'
                />
                {form.formState.errors.title && (
                  <p
                    id='announcement-title-error'
                    role='alert'
                    className='text-destructive text-sm'
                  >
                    {t(form.formState.errors.title.message ?? 'Required')}
                  </p>
                )}
              </div>
              <div className='space-y-2'>
                <Label htmlFor='announcement-body'>
                  {t('Announcement content')}
                </Label>
                <Textarea
                  id='announcement-body'
                  {...form.register('body')}
                  className='min-h-72 resize-y leading-7'
                  aria-invalid={Boolean(form.formState.errors.body)}
                  aria-describedby='announcement-body-help announcement-body-error'
                />
                <p
                  id='announcement-body-help'
                  className='text-muted-foreground text-xs'
                >
                  {t(
                    'Content is sent as plain text. The title is formatted automatically.'
                  )}
                </p>
                {form.formState.errors.body && (
                  <p
                    id='announcement-body-error'
                    role='alert'
                    className='text-destructive text-sm'
                  >
                    {t(form.formState.errors.body.message ?? 'Required')}
                  </p>
                )}
              </div>
              <div className='flex items-start gap-3 rounded-lg border p-3'>
                <Checkbox
                  id='announcement-channel'
                  checked={input.publish_to_channel}
                  disabled={
                    !props.config.connected || !props.config.channel_configured
                  }
                  onCheckedChange={(checked) =>
                    form.setValue('publish_to_channel', checked)
                  }
                  aria-describedby='announcement-channel-help'
                  className='mt-0.5'
                />
                <div className='min-w-0 space-y-1'>
                  <Label htmlFor='announcement-channel'>
                    {t('Also publish to channel')}
                  </Label>
                  <p
                    id='announcement-channel-help'
                    className='text-muted-foreground text-xs'
                  >
                    {props.config.channel_configured
                      ? t('Unchecked: group only. Checked: group and channel.')
                      : t(
                          'Configure the announcement channel before enabling this option.'
                        )}
                  </p>
                </div>
              </div>
              <div className='flex items-center justify-between gap-4 rounded-lg border p-3'>
                <Label htmlFor='announcement-pin'>
                  {t('Pin in group after publishing')}
                </Label>
                <Switch
                  id='announcement-pin'
                  checked={input.pin}
                  onCheckedChange={(checked) => form.setValue('pin', checked)}
                />
              </div>
              {!props.config.connected && (
                <p role='status' className='text-destructive text-sm'>
                  {t(
                    'The announcement bot is not connected. Configure its protected server file first.'
                  )}
                </p>
              )}
              <Button
                type='submit'
                disabled={
                  !props.config.connected ||
                  preview.isPending ||
                  publish.isPending
                }
                className='w-full sm:w-auto'
              >
                <Send className='size-4' aria-hidden='true' />
                {preview.isPending ? t('Loading...') : t('Preview and publish')}
              </Button>
            </form>
          </CardContent>
        </Card>
        <section
          className='bg-muted/40 min-w-0 rounded-xl border p-4 sm:p-6'
          aria-label={t('Announcement preview')}
        >
          <div className='text-muted-foreground mb-5 flex items-center gap-2 text-sm font-medium'>
            <Eye className='size-4' aria-hidden='true' />
            {t('Announcement preview')}
          </div>
          <AnnouncementMessage
            input={input}
            template={props.config.template}
            username={props.config.bot_username}
          />
        </section>
      </div>
      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !publish.isPending) setConfirmation(null)
        }}
        title={t('Publish this announcement?')}
        desc={
          confirmation?.preview.publish_to_channel
            ? t(
                'This announcement will be sent to both the group and the channel.'
              )
            : t('Group members will receive this announcement immediately.')
        }
        confirmText={t('Publish announcement')}
        isLoading={publish.isPending}
        className='max-h-[90dvh] overflow-y-auto sm:max-w-xl'
        handleConfirm={() => {
          if (!confirmation || publish.isPending) return
          publish.mutate({
            title: confirmation.preview.title,
            body: confirmation.preview.body,
            pin: confirmation.preview.pin,
            publish_to_channel: confirmation.preview.publish_to_channel,
            id: confirmation.id,
            preview_hash: confirmation.preview.hash,
          })
        }}
      >
        {confirmation && (
          <div className='min-w-0 space-y-3'>
            {confirmation.preview.publish_to_channel && (
              <p className='text-sm font-medium'>
                {t('Channel: {{channel}}', {
                  channel: confirmation.preview.channel_title,
                })}
              </p>
            )}
            <AnnouncementMessage
              input={confirmation.preview}
              template={confirmation.preview.template}
              username={confirmation.preview.bot_username}
            />
            <p className='text-muted-foreground text-xs'>
              {t('Characters: {{count}} / 4096', {
                count: confirmation.preview.characters,
              })}
            </p>
          </div>
        )}
      </ConfirmDialog>
    </>
  )
}
