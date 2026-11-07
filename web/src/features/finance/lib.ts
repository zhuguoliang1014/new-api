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
import type { TFunction } from 'i18next'

import type { FinanceCategory, FinanceInput, FinanceKind } from './types'

// Cash amounts always use CNY, independently of the site's quota display mode.
export function financeMoney(cents: number, locale?: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}
export function financeCents(value: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents <= 100_000_000_000 ? cents : null
}
export function financeToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}
export function financeKindLabel(t: TFunction, kind: FinanceKind): string {
  switch (kind) {
    case 'income':
      return t('Income')
    case 'expense':
      return t('Expense')
    case 'historical_income':
      return t('Historical net income')
    case 'customer_refund':
      return t('Customer refund')
    case 'supplier_refund':
      return t('Supplier refund')
    case 'fee_refund':
      return t('Payment fee refund')
  }
}
export function financeCategories(
  t: TFunction,
  records?: FinanceCategory[]
): { value: string; label: string; enabled: boolean }[] {
  const defaults = [
    { value: 'upstream_credit', label: t('Upstream credit') },
    { value: 'upstream_plan', label: t('Upstream subscription') },
    { value: 'server', label: t('Servers and domains') },
    { value: 'accounts', label: t('Account purchases') },
    { value: 'proxy', label: t('Proxies and verification') },
    { value: 'promotion', label: t('Promotion and cash gifts') },
    { value: 'payment_service', label: t('Payment service fees') },
    { value: 'other', label: t('Other') },
  ]
  if (!records) return defaults.map((item) => ({ ...item, enabled: true }))
  return records.map((item) => ({
    value: item.code,
    label: item.built_in
      ? (defaults.find((builtin) => builtin.value === item.code)?.label ??
        item.name)
      : item.name,
    enabled: item.enabled,
  }))
}
export const financeCSVHeader =
  'kind,month,date,amount_cny,category,counterparty,payer,method,note,source_ref'

// Small RFC 4180 reader for the documented import template. No evaluation of formulas.
export function parseFinanceCSV(text: string): FinanceInput[] {
  const records: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false
  const source = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        quoted = false
        closed = true
      } else field += char
    } else if (char === '"' && !field && !closed) quoted = true
    else if (char === ',' || char === '\n' || char === '\r') {
      row.push(field)
      field = ''
      closed = false
      if (char !== ',') {
        if (row.some((value) => value !== '')) records.push(row)
        row = []
        if (char === '\r' && source[i + 1] === '\n') i++
      }
    } else {
      if (closed || char === '"') throw new Error('Invalid CSV format')
      field += char
    }
  }
  if (quoted) throw new Error('Invalid CSV format')
  if (field || row.length || closed) {
    row.push(field)
    records.push(row)
  }
  const headers = records.shift()
  if (
    headers?.join(',') !== financeCSVHeader ||
    !records.length ||
    records.length > 2000
  ) {
    throw new Error('Use the financial CSV template with 1 to 2000 rows')
  }
  return records.map((values) => {
    if (values.length !== headers.length) throw new Error('Invalid CSV format')
    const [
      kind,
      month,
      date,
      amount,
      category,
      counterparty,
      payer,
      method,
      note,
      sourceRef,
    ] = values
    const cents = financeCents(amount)
    if (
      cents === null ||
      cents <= 0 ||
      (kind !== 'expense' && kind !== 'historical_income')
    ) {
      throw new Error('Invalid financial amount or import type')
    }
    return {
      kind,
      month,
      date,
      amount_cents: cents,
      fee_cents: null,
      category,
      counterparty,
      payer,
      method,
      note,
      source_ref: sourceRef,
      related_id: 0,
      request_id: '',
      version: 0,
      reason: '',
    }
  })
}
