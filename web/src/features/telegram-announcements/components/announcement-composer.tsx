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
import { Bold, Code, Eye, Italic, Link, Quote, Send } from 'lucide-react'
import { useRef } from 'react'
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { useAnnouncementPublisher } from '../hooks/use-announcement-publisher'
import { announcementSchema } from '../lib/schema'
import type { AnnouncementConfig, AnnouncementInput } from '../types'
import { AnnouncementMessage } from './announcement-preview'

export function AnnouncementComposer(props: { config: AnnouncementConfig }) {
  const { t } = useTranslation()
  const bodyRef = useRef<HTMLTextAreaElement | null>(null)
  const form = useForm<AnnouncementInput>({
    resolver: zodResolver(announcementSchema),
    defaultValues: {
      title: '',
      body: '',
      body_format: 'markdown',
      pin: false,
      publish_to_channel: props.config.channel_configured,
    },
  })
  const values = useWatch({ control: form.control })
  const input = {
    title: values.title ?? '',
    body: values.body ?? '',
    body_format: values.body_format ?? 'markdown',
    pin: values.pin ?? false,
    publish_to_channel:
      values.publish_to_channel ?? props.config.channel_configured,
  }
  const { confirmation, setConfirmation, preview, publish } =
    useAnnouncementPublisher(() => form.reset())
  const bodyField = form.register('body')
  const formatting = [
    { label: t('Bold'), icon: Bold, before: '**', after: '**' },
    { label: t('Italic'), icon: Italic, before: '_', after: '_' },
    { label: t('Inline code'), icon: Code, before: '`', after: '`' },
    { label: t('Quote'), icon: Quote, before: '> ', after: '' },
    {
      label: t('Link'),
      icon: Link,
      before: '[',
      after: '](https://example.com)',
    },
  ]
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
                <div
                  role='group'
                  aria-label={t('Text formatting')}
                  className='flex flex-wrap gap-1'
                >
                  {formatting.map((item) => (
                    <Button
                      key={item.label}
                      type='button'
                      variant='outline'
                      size='sm'
                      aria-label={item.label}
                      onClick={() => {
                        const body = bodyRef.current
                        if (!body) return
                        const start = body.selectionStart
                        const end = body.selectionEnd
                        const selected =
                          body.value.slice(start, end) || t('Text')
                        const formatted =
                          item.before +
                          selected.replaceAll(
                            '\n',
                            item.before === '> ' ? '\n> ' : '\n'
                          ) +
                          item.after
                        form.setValue(
                          'body',
                          body.value.slice(0, start) +
                            formatted +
                            body.value.slice(end),
                          { shouldDirty: true, shouldValidate: true }
                        )
                        requestAnimationFrame(() => {
                          body.focus()
                          body.setSelectionRange(
                            start + item.before.length,
                            start + item.before.length + selected.length
                          )
                        })
                      }}
                    >
                      <item.icon className='size-4' aria-hidden='true' />
                      <span>{item.label}</span>
                    </Button>
                  ))}
                </div>
                <Textarea
                  id='announcement-body'
                  {...bodyField}
                  ref={(element) => {
                    bodyField.ref(element)
                    bodyRef.current = element
                  }}
                  className='min-h-72 resize-y leading-7'
                  aria-invalid={Boolean(form.formState.errors.body)}
                  aria-describedby='announcement-body-help announcement-body-error'
                />
                <p
                  id='announcement-body-help'
                  className='text-muted-foreground text-xs'
                >
                  {t(
                    'Supports Markdown: **bold**, _italic_, `code`, > quotes and [links](https://example.com). The title is bold automatically.'
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
              <FieldSet>
                <FieldLegend variant='label'>
                  {t('Publishing destination')}
                </FieldLegend>
                <RadioGroup
                  aria-label={t('Publishing destination')}
                  value={input.publish_to_channel ? 'channel' : 'group'}
                  onValueChange={(value) => {
                    form.setValue('publish_to_channel', value === 'channel')
                    if (value === 'channel') form.setValue('pin', false)
                  }}
                >
                  <Field
                    orientation='horizontal'
                    className='rounded-lg border p-3'
                  >
                    <RadioGroupItem
                      id='announcement-channel'
                      value='channel'
                      disabled={
                        !props.config.connected ||
                        !props.config.channel_configured
                      }
                      aria-describedby='announcement-channel-help'
                    />
                    <FieldContent>
                      <FieldLabel htmlFor='announcement-channel'>
                        {t('Publish to channel')}
                      </FieldLabel>
                      <FieldDescription
                        id='announcement-channel-help'
                        className='text-xs'
                      >
                        {props.config.channel_configured
                          ? t(
                              'Post once to the channel. Telegram automatically forwards it to the linked discussion group.'
                            )
                          : t(
                              'Configure the announcement channel before selecting this destination.'
                            )}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                  <Field
                    orientation='horizontal'
                    className='rounded-lg border p-3'
                  >
                    <RadioGroupItem
                      id='announcement-group'
                      value='group'
                      disabled={!props.config.connected}
                      aria-describedby='announcement-group-help'
                    />
                    <FieldContent>
                      <FieldLabel htmlFor='announcement-group'>
                        {t('Group only')}
                      </FieldLabel>
                      <FieldDescription
                        id='announcement-group-help'
                        className='text-xs'
                      >
                        {t(
                          'Send a group notice without posting to the channel.'
                        )}
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </RadioGroup>
              </FieldSet>
              {!input.publish_to_channel && (
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
              )}
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
                'This announcement will be posted once to the channel. Telegram will automatically forward it to the linked discussion group.'
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
            body_format: confirmation.preview.body_format,
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
              bodyHTML={confirmation.preview.body_html}
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
