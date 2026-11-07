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
export type FinanceKind =
  | 'income'
  | 'expense'
  | 'historical_income'
  | 'customer_refund'
  | 'supplier_refund'
  | 'fee_refund'
export interface FinanceInput {
  kind: FinanceKind
  month: string
  date: string
  amount_cents: number
  fee_cents: number | null
  method: string
  category: string
  counterparty: string
  payer: string
  note: string
  related_id: number
  source_ref: string
  request_id: string
  version: number
  reason: string
}
export interface FinanceEntry extends Omit<
  FinanceInput,
  'request_id' | 'reason'
> {
  id: number
  entry_key: string
  currency: string
  fee_confirmed: boolean
  rate_bps: number
  provider: string
  business: string
  source: string
  user_id: number
  voided: boolean
  created_by: number
  updated_by: number
  created_at: number
  updated_at: number
}
export interface FinanceSummary {
  month: string
  net_income_cents: number
  gross_income_cents: number
  fee_cents: number
  expense_cents: number
  customer_refund_cents: number
  supplier_refund_cents: number
  fee_refund_cents: number
  balance_cents: number
  historical_net: boolean
  estimated_fees: number
  unresolved: number
  count: number
  categories: Record<string, number>
}
export interface FinanceReport {
  categories: FinanceCategory[]
  summary: FinanceSummary
  months: FinanceSummary[]
  periods: { month: string; locked: boolean }[]
  rules: { id: number; method: string; effective: string; rate_bps: number }[]
  synced_at: number
}
export interface FinanceCategory {
  id: number
  code: string
  name: string
  enabled: boolean
  built_in: boolean
}
export interface FinanceFilter {
  view?: 'summary'
  from: string
  to: string
  page?: number
  kind?: string
  search?: string
  payer?: string
  category?: string
  source?: string
  include_voided?: boolean
}
export interface FinancePreview {
  rows: {
    input: FinanceInput
    line: number
    duplicate: boolean
    error: string
  }[]
  hash: string
  ready: number
  duplicates: number
  errors: number
}
export interface FinanceDetails {
  entry: FinanceEntry
  audits: {
    id: number
    actor_id: number
    action: string
    reason: string
    before: string
    after: string
    created_at: number
  }[]
  attachments: { id: number; name: string; mime: string }[]
}
