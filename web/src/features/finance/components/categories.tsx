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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

import { financeCategories } from '../lib'
import type { FinanceCategory } from '../types'

export function FinanceCategorySettings(props: {
  categories: FinanceCategory[]
  canManage: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const client = useQueryClient()
  const [name, setName] = useState(''),
    [editing, setEditing] = useState<FinanceCategory | null>(null)
  const labels = financeCategories(t, props.categories)
  const mutation = useMutation({
    mutationFn: async (input: {
      id?: number
      name: string
      enabled: boolean
    }) => {
      const response = await api.request<{ success: boolean; message: string }>(
        {
          url: input.id
            ? `/api/finance/categories/${input.id}`
            : '/api/finance/categories',
          method: input.id ? 'PUT' : 'POST',
          data: { name: input.name, enabled: input.enabled },
          skipBusinessError: true,
          skipErrorHandler: true,
        }
      )
      if (!response.data.success) throw createServerError(response.data)
    },
    onSuccess: async () => {
      setName('')
      setEditing(null)
      await client.invalidateQueries({ queryKey: ['finance'] })
    },
  })
  return (
    <section className='flex flex-col gap-3'>
      <h3 className='font-medium'>{t('Expense categories')}</h3>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Custom categories can be renamed or disabled. Existing records are preserved.'
        )}
      </p>
      {props.canManage && (
        <form
          className='flex flex-wrap items-end gap-3'
          onSubmit={(e) => {
            e.preventDefault()
            mutation.mutate({
              id: editing?.id,
              name: name.trim(),
              enabled: editing?.enabled ?? true,
            })
          }}
        >
          <div className='grid gap-2'>
            <Label htmlFor='category-name'>{t('Category name')}</Label>
            <Input
              id='category-name'
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
            />
          </div>
          <Button type='submit' disabled={!name.trim() || mutation.isPending}>
            {editing ? t('Save') : t('Add category')}
          </Button>
          {editing && (
            <Button
              variant='outline'
              type='button'
              onClick={() => {
                setEditing(null)
                setName('')
              }}
            >
              {t('Cancel')}
            </Button>
          )}
        </form>
      )}
      <StaticDataTable
        data={props.categories}
        getRowKey={(row) => row.code}
        columns={[
          {
            id: 'name',
            header: t('Category'),
            cell: (row) =>
              labels.find((item) => item.value === row.code)?.label ?? row.name,
          },
          {
            id: 'status',
            header: t('Status'),
            cell: (row) => (row.enabled ? t('Enabled') : t('Disabled')),
          },
          {
            id: 'actions',
            header: t('Actions'),
            cell: (row) =>
              props.canManage && (
                <div className='flex gap-2'>
                  {!row.built_in && (
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => {
                        setEditing(row)
                        setName(row.name)
                      }}
                    >
                      {t('Edit')}
                    </Button>
                  )}
                  <Button
                    size='sm'
                    variant='ghost'
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        id: row.id,
                        name: row.name,
                        enabled: !row.enabled,
                      })
                    }
                  >
                    {row.enabled ? t('Disable') : t('Enable')}
                  </Button>
                </div>
              ),
          },
        ]}
      />
    </section>
  )
}
