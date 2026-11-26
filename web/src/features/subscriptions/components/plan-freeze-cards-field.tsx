import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

export function PlanFreezeCardsField() {
  const { t } = useTranslation()
  const form = useFormContext<{ freeze_cards: number }>()
  return (
    <FormField
      control={form.control}
      name='freeze_cards'
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t('Bonus freeze cards')}</FormLabel>
          <FormControl>
            <Input {...field} type='number' min={0} max={1000000} step={1} />
          </FormControl>
          <FormDescription>
            {t(
              'Granted after each successful purchase. Cards can freeze any active subscription; 0 means no bonus cards.'
            )}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
