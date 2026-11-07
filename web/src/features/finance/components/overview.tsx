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
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { toIntlLocale } from '@/i18n/languages'

import { financeCategories, financeMoney } from '../lib'
import type { FinanceReport } from '../types'

export function FinanceOverview(props: {
  report: FinanceReport
  onMonth: (month: string) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const money = (cents: number): string => financeMoney(cents, locale)
  const s = props.report.summary
  const categories = financeCategories(t, props.report.categories)
  return (
    <div className='flex flex-col gap-5'>
      {s.unresolved > 0 && (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              '{{count}} payments need currency or fee reconciliation and are excluded from totals.',
              { count: s.unresolved }
            )}
          </AlertDescription>
        </Alert>
      )}
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        {[
          {
            label: t('Net cash income'),
            value: money(s.net_income_cents),
            hint: t('After payment fees'),
          },
          {
            label: t('Payment fees'),
            value:
              s.historical_net && s.gross_income_cents === 0
                ? t('Included in historical net income')
                : money(s.fee_cents),
            hint: s.estimated_fees
              ? t('Estimated; reconcile against payment statements')
              : t('Recorded fees'),
          },
          {
            label: t('Operating expenses'),
            value: money(s.expense_cents),
            hint: t('Actual supplier payments'),
          },
          {
            label: t('Cash surplus'),
            value: money(s.balance_cents),
            hint: t('After expenses and refunds'),
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className='bg-card min-w-0 rounded-xl border p-5'
          >
            <p className='text-muted-foreground text-sm'>{stat.label}</p>
            <p className='my-3 text-2xl font-semibold break-words tabular-nums'>
              {stat.value}
            </p>
            <p className='text-muted-foreground text-xs'>{stat.hint}</p>
          </div>
        ))}
      </div>
      <div className='grid gap-4 lg:grid-cols-2'>
        <section className='rounded-xl border p-5'>
          <h3 className='mb-3 font-medium'>{t('Cash calculation')}</h3>
          <dl className='flex flex-col gap-3'>
            {[
              [t('Net cash income'), money(s.net_income_cents)],
              [t('Customer refund'), `− ${money(s.customer_refund_cents)}`],
              [t('Operating expenses'), `− ${money(s.expense_cents)}`],
              [t('Supplier refund'), `+ ${money(s.supplier_refund_cents)}`],
              [t('Payment fee refund'), `+ ${money(s.fee_refund_cents)}`],
            ].map(([label, value]) => (
              <div
                key={label}
                className='flex flex-wrap justify-between gap-2 text-sm'
              >
                <dt>{label}</dt>
                <dd className='tabular-nums'>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className='rounded-xl border p-5'>
          <h3 className='mb-3 font-medium'>{t('Expense categories')}</h3>
          <dl className='flex flex-col gap-3'>
            {Object.entries(s.categories)
              .sort((a, b) => b[1] - a[1])
              .map(([category, amount]) => (
                <div
                  key={category}
                  className='flex flex-wrap justify-between gap-2 text-sm'
                >
                  <dt>
                    {categories.find((item) => item.value === category)
                      ?.label ?? category}
                  </dt>
                  <dd className='tabular-nums'>{money(amount)}</dd>
                </div>
              ))}
          </dl>
          {!Object.keys(s.categories).length && (
            <p className='text-muted-foreground text-sm'>{t('No data')}</p>
          )}
        </section>
      </div>
      <section className='flex flex-col gap-3'>
        <h3 className='font-medium'>{t('Monthly cash report')}</h3>
        <StaticDataTable
          data={props.report.months}
          getRowKey={(row) => row.month}
          columns={[
            {
              id: 'month',
              header: t('Accounting month'),
              cell: (row) => (
                <Button
                  variant='link'
                  size='sm'
                  onClick={() => props.onMonth(row.month)}
                >
                  {row.month}
                </Button>
              ),
            },
            {
              id: 'income',
              header: t('Net cash income'),
              cell: (row) => money(row.net_income_cents),
            },
            {
              id: 'fees',
              header: t('Payment fees'),
              cell: (row) =>
                row.historical_net
                  ? t('Included in historical net income')
                  : money(row.fee_cents),
            },
            {
              id: 'expenses',
              header: t('Operating expenses'),
              cell: (row) => money(row.expense_cents),
            },
            {
              id: 'surplus',
              header: t('Cash surplus'),
              cell: (row) => money(row.balance_cents),
            },
          ]}
        />
      </section>
      <p className='text-muted-foreground text-xs'>
        {t(
          'Cash accounting in CNY and Beijing time. Upstream credit is an expense when paid. This is not an account balance or accrued profit.'
        )}
      </p>
    </div>
  )
}
