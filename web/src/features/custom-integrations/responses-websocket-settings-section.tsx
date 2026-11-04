import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

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
import { SettingsForm } from '@/features/system-settings/components/settings-form-layout'
import { SettingsPageFormActions } from '@/features/system-settings/components/settings-page-context'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { useResetForm } from '@/features/system-settings/hooks/use-reset-form'
import { useUpdateOption } from '@/features/system-settings/hooks/use-update-option'

import type { CustomIntegrationSettings } from './types'

type WebSocketSettings = Pick<
  CustomIntegrationSettings,
  'ResponsesWSMaxConnectionsPerUser'
>

export function ResponsesWebSocketSettingsSection(props: {
  defaultValues: WebSocketSettings
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const validationMessage = t(
    'WebSocket connection limit must be an integer from 1 to 1000.'
  )
  const schema = z.object({
    ResponsesWSMaxConnectionsPerUser: z
      .number({ error: validationMessage })
      .int(validationMessage)
      .min(1, validationMessage)
      .max(1000, validationMessage),
  })
  const form = useForm<WebSocketSettings>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: props.defaultValues,
  })
  useResetForm(form, props.defaultValues)

  const onSubmit = async (values: WebSocketSettings) => {
    const key = 'ResponsesWSMaxConnectionsPerUser'
    if (values[key] !== props.defaultValues[key]) {
      await updateOption.mutateAsync({ key, value: values[key] })
    }
  }

  return (
    <SettingsSection title={t('Responses WebSocket')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending}
          />
          <FormField
            control={form.control}
            name='ResponsesWSMaxConnectionsPerUser'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('Responses WebSocket connections per user')}
                </FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={1}
                    max={1000}
                    step={1}
                    {...field}
                    value={field.value ?? ''}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? undefined
                          : Number(event.target.value)
                      )
                    }
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Default 10. Shared across each user’s API keys, devices and agents. Changes apply to new connections; existing connections stay open. HTTPS requests remain available when the limit is reached.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
