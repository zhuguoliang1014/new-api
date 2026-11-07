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
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'

import { saveFinanceEntry } from '../api'
import {
  financeCategories,
  financeCents,
  financeKindLabel,
  financeToday,
} from '../lib'
import type {
  FinanceCategory,
  FinanceEntry,
  FinanceInput,
  FinanceKind,
} from '../types'

const schema = z.object({
  date: z.string(),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid financial month or amount'),
  amount: z
    .string()
    .refine(
      (value) => (financeCents(value) ?? 0) > 0,
      'Invalid financial amount'
    ),
  fee: z
    .string()
    .refine((value) => financeCents(value) !== null, 'Invalid payment fee'),
  category: z.string().max(80),
  counterparty: z.string().max(120),
  payer: z.string().max(80),
  method: z.string().max(50),
  note: z.string().max(3000),
  source_ref: z.string().max(255),
  reason: z.string().max(500),
})
type Form = z.infer<typeof schema>
export function FinanceEntryDialog(props: {
  categories: FinanceCategory[]
  kind: FinanceKind
  entry?: FinanceEntry
  related?: FinanceEntry
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [requestID] = useState(() => crypto.randomUUID())
  const [error, setError] = useState('')
  const entry = props.entry
  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: entry?.date ?? financeToday(),
      month: entry?.month ?? financeToday().slice(0, 7),
      amount: entry ? (entry.amount_cents / 100).toFixed(2) : '',
      fee: ((entry?.fee_cents ?? 0) / 100).toFixed(2),
      category: entry?.category ?? 'upstream_credit',
      counterparty: entry?.counterparty ?? '',
      payer: entry?.payer ?? '国良',
      method: entry?.method ?? 'alipay',
      note: entry?.note ?? '',
      source_ref: entry?.source_ref ?? '',
      reason: '',
    },
  })
  const mutation = useMutation({
    mutationFn: (input: FinanceInput) => saveFinanceEntry(entry?.id, input),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['finance'] })
      toast.success(t('Saved successfully'))
      props.onClose()
    },
  })
  const submit = (values: Form): void => {
    setError('')
    const amount = financeCents(values.amount),
      fee = financeCents(values.fee)
    if (amount === null || fee === null) {
      setError(t('Invalid financial amount'))
      return
    }
    if (props.kind === 'income' && fee > amount) {
      setError(t('Invalid payment fee'))
      return
    }
    if (
      props.kind === 'expense' &&
      (!values.counterparty.trim() || !values.payer.trim())
    ) {
      setError(t('Category, payee and payer are required'))
      return
    }
    if (entry && !values.reason.trim()) {
      setError(t('A reason is required for financial changes'))
      return
    }
    mutation.mutate({
      ...values,
      kind: props.kind,
      month: values.date ? values.date.slice(0, 7) : values.month,
      amount_cents: amount,
      fee_cents: props.kind === 'income' ? fee : null,
      method: props.kind === 'income' ? 'wechat_offline' : values.method,
      related_id: props.related?.id ?? entry?.related_id ?? 0,
      request_id: requestID,
      version: entry?.version ?? 0,
    })
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
      title={
        entry ? t('Edit financial entry') : financeKindLabel(t, props.kind)
      }
      description={
        props.kind === 'income'
          ? t(
              'Record offline WeChat payments only. This does not credit a user balance.'
            )
          : t('Record actual payments in CNY.')
      }
      contentClassName='sm:max-w-xl'
      footer={
        <>
          <Button
            variant='outline'
            onClick={props.onClose}
            disabled={mutation.isPending}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form='finance-entry-form'
            disabled={mutation.isPending}
          >
            {t('Save')}
          </Button>
        </>
      }
    >
      <form
        id='finance-entry-form'
        onSubmit={form.handleSubmit(submit)}
        className='grid gap-4 sm:grid-cols-2'
      >
        {props.related && (
          <p className='text-muted-foreground text-sm sm:col-span-2'>
            {t('Original entry')}: #{props.related.id} ·{' '}
            {props.related.counterparty || props.related.source_ref}
          </p>
        )}
        <div className='grid gap-2'>
          <Label htmlFor='finance-date'>{t('Payment date')}</Label>
          <Input
            id='finance-date'
            type='date'
            required={entry?.source !== 'import'}
            {...form.register('date')}
          />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='finance-amount'>{t('Amount')} (CNY)</Label>
          <Input
            id='finance-amount'
            inputMode='decimal'
            placeholder='0.00'
            {...form.register('amount')}
            aria-invalid={!!form.formState.errors.amount}
          />
          {form.formState.errors.amount && (
            <p role='alert' className='text-destructive text-sm'>
              {t('Invalid financial amount')}
            </p>
          )}
        </div>
        {entry?.source === 'import' && (
          <div className='grid gap-2'>
            <Label htmlFor='finance-month'>{t('Accounting month')}</Label>
            <Input
              id='finance-month'
              type='month'
              {...form.register('month')}
            />
          </div>
        )}
        {props.kind === 'income' && (
          <>
            <div className='grid gap-2'>
              <Label htmlFor='finance-fee'>
                {t('Actual payment fee')} (CNY)
              </Label>
              <Input
                id='finance-fee'
                inputMode='decimal'
                {...form.register('fee')}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='finance-ref'>{t('Payment reference')}</Label>
              <Input id='finance-ref' {...form.register('source_ref')} />
            </div>
          </>
        )}
        {props.kind === 'expense' && (
          <>
            <div className='grid gap-2'>
              <Label htmlFor='finance-category'>{t('Category')}</Label>
              <NativeSelect
                id='finance-category'
                className='w-full'
                {...form.register('category')}
              >
                {financeCategories(t, props.categories)
                  .filter(
                    (item) => item.enabled || item.value === entry?.category
                  )
                  .map((item) => (
                    <NativeSelectOption key={item.value} value={item.value}>
                      {item.label}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='finance-payer'>{t('Payer')}</Label>
              <NativeSelect
                id='finance-payer'
                className='w-full'
                {...form.register('payer')}
                required
              >
                <NativeSelectOption value='西强'>
                  {t('Xiqiang')}
                </NativeSelectOption>
                <NativeSelectOption value='国良'>
                  {t('Guoliang')}
                </NativeSelectOption>
              </NativeSelect>
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='finance-payee'>{t('Payee or supplier')}</Label>
              <Input
                id='finance-payee'
                {...form.register('counterparty')}
                required
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='finance-method'>{t('Payment Method')}</Label>
              <NativeSelect
                id='finance-method'
                className='w-full'
                {...form.register('method')}
              >
                <NativeSelectOption value='alipay'>
                  {t('Alipay')}
                </NativeSelectOption>
                <NativeSelectOption value='wechat'>
                  {t('WeChat')}
                </NativeSelectOption>
                <NativeSelectOption value='bank'>
                  {t('Bank transfer')}
                </NativeSelectOption>
                <NativeSelectOption value='other'>
                  {t('Other')}
                </NativeSelectOption>
              </NativeSelect>
            </div>
          </>
        )}
        <div className='grid gap-2 sm:col-span-2'>
          <Label htmlFor='finance-note'>{t('Notes')}</Label>
          <Textarea
            id='finance-note'
            {...form.register('note')}
            required={props.kind === 'income'}
          />
        </div>
        {entry && (
          <div className='grid gap-2 sm:col-span-2'>
            <Label htmlFor='finance-reason'>{t('Reason for change')}</Label>
            <Input id='finance-reason' {...form.register('reason')} required />
          </div>
        )}
        {error && (
          <p role='alert' className='text-destructive text-sm sm:col-span-2'>
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
