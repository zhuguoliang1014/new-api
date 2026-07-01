import { useMemo, useRef } from 'react'
import * as z from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { useResetForm } from '@/features/system-settings/hooks/use-reset-form'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'
import type { CustomIntegrationSettings } from './types'

const schema = z.object({
  WechatBotEnabled: z.boolean(),
  WechatBotUserId: z.string(),
  WechatBotGroupIds: z.string(),
})

type FormValues = z.infer<typeof schema>

type Props = {
  defaultValues: CustomIntegrationSettings
}

export function WechatBotSection({ defaultValues }: Props) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const baselineRef = useRef<CustomIntegrationSettings>(defaultValues)

  const formDefaults = useMemo(
    () => ({
      WechatBotEnabled: defaultValues.WechatBotEnabled,
      WechatBotUserId: defaultValues.WechatBotUserId ?? '',
      WechatBotGroupIds: defaultValues.WechatBotGroupIds ?? '',
    }),
    [defaultValues]
  )

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })

  useResetForm(form, formDefaults)

  const onSubmit = async (values: FormValues) => {
    const keys = Object.keys(values) as Array<keyof FormValues>
    const changed = keys.filter(
      (k) => String(values[k]) !== String(baselineRef.current[k])
    )
    if (changed.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const key of changed) {
      await updateOption.mutateAsync({ key, value: values[key] })
    }
    baselineRef.current = { ...baselineRef.current, ...values }
  }

  return (
    <SettingsSection title={t('WeChat Group Notifications')}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className='space-y-6'>
          <FormField
            control={form.control}
            name='WechatBotEnabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>
                    {t('Enable WeChat notifications')}
                  </FormLabel>
                  <FormDescription>
                    {t(
                      'Send event notifications to configured WeChat groups'
                    )}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='WechatBotUserId'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Bot User ID')}</FormLabel>
                <FormControl>
                  <Input placeholder='NZ0000' {...field} />
                </FormControl>
                <FormDescription>
                  {t('The WeChat bot user ID used to send messages')}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='WechatBotGroupIds'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Group IDs')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    placeholder='53505257129@chatroom,54685112607@chatroom'
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Comma-separated WeChat group IDs to receive notifications'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type='submit' disabled={updateOption.isPending}>
            {updateOption.isPending ? t('Saving...') : t('Save')}
          </Button>
        </form>
      </Form>
    </SettingsSection>
  )
}
