import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

export function PlanGroupFields(props: { groupOptions: string[] }) {
  const { t } = useTranslation()
  const form = useFormContext<{ allowed_groups: string[] }>()
  return (
    <FormField
      control={form.control}
      name='allowed_groups'
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('Subscription groups')}</FormLabel>
          <FormControl>
            <MultiSelect
              options={props.groupOptions.map((group) => ({
                value: group,
                label: group,
              }))}
              selected={field.value}
              onChange={field.onChange}
              placeholder={t('Select subscription groups')}
            />
          </FormControl>
          <FormDescription>
            {t(
              'Select one or more configured groups. Subscription quota applies when the API key uses one of these groups; otherwise, wallet balance is used.'
            )}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
