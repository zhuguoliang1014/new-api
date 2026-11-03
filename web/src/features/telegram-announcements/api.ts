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
  AnnouncementConfig,
  AnnouncementHistory,
  AnnouncementInput,
  AnnouncementPreview,
  AnnouncementRecord,
  AnnouncementTemplate,
} from './types'

type Response<T> = { success: boolean; message: string; data: T }
const mutationConfig = { skipBusinessError: true, skipErrorHandler: true }
function requireSuccess<T>(response: Response<T>): T {
  if (!response.success) throw createServerError(response)
  return response.data
}
export async function getAnnouncementConfig(): Promise<AnnouncementConfig> {
  const response = await api.get<Response<AnnouncementConfig>>(
    '/api/telegram-announcements/config'
  )
  return requireSuccess(response.data)
}
export async function saveAnnouncementTemplate(
  template: AnnouncementTemplate
): Promise<AnnouncementTemplate> {
  const response = await api.put<Response<AnnouncementTemplate>>(
    '/api/telegram-announcements/template',
    template,
    mutationConfig
  )
  return requireSuccess(response.data)
}
export async function previewAnnouncement(
  input: AnnouncementInput
): Promise<AnnouncementPreview> {
  const response = await api.post<Response<AnnouncementPreview>>(
    '/api/telegram-announcements/preview',
    input,
    mutationConfig
  )
  return requireSuccess(response.data)
}
export async function publishAnnouncement(
  request: AnnouncementInput & { id: string; preview_hash: string }
): Promise<AnnouncementRecord> {
  const response = await api.post<Response<AnnouncementRecord>>(
    '/api/telegram-announcements/publish',
    request,
    { ...mutationConfig, timeout: 95000 }
  )
  return requireSuccess(response.data)
}
export async function listAnnouncements(
  page: number
): Promise<AnnouncementHistory> {
  const response = await api.get<Response<AnnouncementHistory>>(
    '/api/telegram-announcements/',
    { params: { page } }
  )
  return requireSuccess(response.data)
}
