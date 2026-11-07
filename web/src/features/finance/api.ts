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
import { api } from '@/lib/api'
import { createServerError } from '@/lib/server-error-message'

import type {
  FinanceDetails,
  FinanceEntry,
  FinanceFilter,
  FinanceInput,
  FinancePreview,
  FinanceReport,
} from './types'

type Response<T> = { success: boolean; message: string; data: T }
const config = { skipBusinessError: true, skipErrorHandler: true }
function result<T>(response: Response<T>): T {
  if (!response.success) throw createServerError(response)
  return response.data
}
export async function syncFinance(): Promise<{ added: number }> {
  return result(
    (
      await api.post<Response<{ added: number }>>(
        '/api/finance/sync',
        {},
        { ...config, timeout: 120000 }
      )
    ).data
  )
}
export async function getFinanceReport(
  filter: FinanceFilter
): Promise<FinanceReport> {
  return result(
    (
      await api.get<Response<FinanceReport>>('/api/finance/report', {
        params: filter,
      })
    ).data
  )
}
export async function listFinanceEntries(
  filter: FinanceFilter
): Promise<{ items: FinanceEntry[]; total: number }> {
  return result(
    (
      await api.get<Response<{ items: FinanceEntry[]; total: number }>>(
        '/api/finance/entries',
        { params: filter }
      )
    ).data
  )
}
export async function saveFinanceEntry(
  id: number | undefined,
  input: FinanceInput
): Promise<FinanceEntry> {
  const path = id ? `/api/finance/entries/${id}` : '/api/finance/entries'
  return result(
    (
      await api.request<Response<FinanceEntry>>({
        ...config,
        url: path,
        method: id ? 'PUT' : 'POST',
        data: input,
      })
    ).data
  )
}
export async function financeAction(
  path: string,
  input: unknown
): Promise<void> {
  result(
    (await api.post<Response<unknown>>(`/api/finance/${path}`, input, config))
      .data
  )
}
export async function getFinanceDetails(id: number): Promise<FinanceDetails> {
  return result(
    (await api.get<Response<FinanceDetails>>(`/api/finance/entries/${id}`)).data
  )
}
export async function previewFinanceImport(
  rows: FinanceInput[]
): Promise<FinancePreview> {
  return result(
    (
      await api.post<Response<FinancePreview>>(
        '/api/finance/import/preview',
        { rows },
        config
      )
    ).data
  )
}
export async function commitFinanceImport(
  rows: FinanceInput[],
  hash: string
): Promise<{ added: number }> {
  return result(
    (
      await api.post<Response<{ added: number }>>(
        '/api/finance/import/commit',
        { rows, hash },
        { ...config, timeout: 120000 }
      )
    ).data
  )
}
export async function uploadFinanceReceipt(
  id: number,
  file: File
): Promise<void> {
  const data = new FormData()
  data.append('file', file)
  result(
    (
      await api.post<Response<unknown>>(
        `/api/finance/entries/${id}/attachments`,
        data,
        config
      )
    ).data
  )
}
export async function downloadFinanceFile(
  path: string,
  name: string,
  params?: FinanceFilter
): Promise<void> {
  const response = await api.get<Blob>(`/api/finance/${path}`, {
    params,
    responseType: 'blob',
    ...config,
  })
  if (response.data.type.includes('json')) {
    throw createServerError(
      JSON.parse(await response.data.text()) as Response<unknown>
    )
  }
  saveFinanceBlob(response.data, name)
}
export function saveFinanceBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
