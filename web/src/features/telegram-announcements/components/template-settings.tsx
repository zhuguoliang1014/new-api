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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import { saveAnnouncementTemplate } from '../api'
import { templateSchema } from '../lib/schema'
import type { AnnouncementConfig, AnnouncementTemplate } from '../types'
import { AnnouncementMessage } from './announcement-preview'

export function TemplateSettings(props: { config: AnnouncementConfig }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<AnnouncementTemplate>({
    resolver: zodResolver(templateSchema),
    defaultValues: props.config.template,
  })
  const values = useWatch({ control: form.control })
  const template = { ...props.config.template, ...values }
  const save = useMutation({
    mutationFn: saveAnnouncementTemplate,
    onSuccess: (saved) => {
      queryClient.setQueryData<AnnouncementConfig>(
        ['telegram-announcements', 'config'],
        (previous) => (previous ? { ...previous, template: saved } : previous)
      )
      form.reset(saved)
      toast.success(t('Announcement template saved'))
    },
    onError: (error) => handleServerError(error),
  })
  const fields = [
    { key: 'channel_label', label: t('Channel button label'), type: 'text' },
    { key: 'channel_url', label: t('Channel address'), type: 'url' },
    {
      key: 'contact_label',
      label: t('Integration button label'),
      type: 'text',
    },
    { key: 'contact_url', label: t('Integration address'), type: 'url' },
  ] as const
  return (
    <div className='grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]'>
      <Card className='min-w-0'>
        <CardHeader>
          <CardTitle>{t('Announcement template')}</CardTitle>
          <CardDescription>
            {t(
              'Saved settings apply to future announcements. Published messages stay unchanged.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={form.handleSubmit((data) => save.mutate(data))}
            className='space-y-4'
          >
            <div className='space-y-2'>
              <Label htmlFor='announcement-footer'>
                {t('Announcement footer')}
              </Label>
              <Textarea
                id='announcement-footer'
                {...form.register('footer')}
                aria-invalid={Boolean(form.formState.errors.footer)}
                aria-describedby='footer-error'
              />
              {form.formState.errors.footer && (
                <p
                  id='footer-error'
                  role='alert'
                  className='text-destructive text-sm'
                >
                  {t(form.formState.errors.footer.message ?? 'Required')}
                </p>
              )}
            </div>
            {fields.map((field) => (
              <div key={field.key} className='space-y-2'>
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type={field.type}
                  {...form.register(field.key)}
                  aria-invalid={Boolean(form.formState.errors[field.key])}
                  aria-describedby={`${field.key}-error`}
                />
                {form.formState.errors[field.key] && (
                  <p
                    id={`${field.key}-error`}
                    role='alert'
                    className='text-destructive text-sm'
                  >
                    {t(form.formState.errors[field.key]?.message ?? 'Required')}
                  </p>
                )}
              </div>
            ))}
            <Button
              type='submit'
              disabled={save.isPending || !form.formState.isDirty}
            >
              {save.isPending ? t('Saving...') : t('Save template')}
            </Button>
          </form>
        </CardContent>
      </Card>
      <section
        className='bg-muted/40 min-w-0 rounded-xl border p-4 sm:p-6'
        aria-label={t('Template preview')}
      >
        <p className='text-muted-foreground mb-5 text-sm font-medium'>
          {t('Template preview')}
        </p>
        <AnnouncementMessage
          input={{
            title: t('Announcement title'),
            body: t('Your announcement will appear here.'),
            pin: false,
            publish_to_channel: false,
          }}
          template={template}
          username={props.config.bot_username}
        />
      </section>
    </div>
  )
}
