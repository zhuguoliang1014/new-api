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
export type AnnouncementTemplate = {
  footer: string
  channel_url: string
  contact_url: string
  channel_label: string
  contact_label: string
}

export type AnnouncementInput = {
  title: string
  body: string
  pin: boolean
  publish_to_channel: boolean
}
export type AnnouncementPreview = AnnouncementInput & {
  template: AnnouncementTemplate
  text: string
  characters: number
  hash: string
  chat_id: number
  channel_chat_id: number
  channel_title: string
  bot_username: string
}
export type AnnouncementConfig = {
  connected: boolean
  channel_configured: boolean
  bot_username: string
  template: AnnouncementTemplate
}
export type AnnouncementRecord = {
  id: string
  title: string
  body: string
  footer: string
  channel_url: string
  contact_url: string
  status: 'prepared' | 'sending' | 'sent' | 'failed' | 'unknown'
  pin_status: 'not_requested' | 'pending' | 'pinned' | 'failed'
  pin_requested: boolean
  message_url: string
  message_id: number
  operator_id: number
  created_at: number
  error: string
  channel_requested: boolean
  channel_status:
    | ''
    | 'not_requested'
    | 'queued'
    | 'sending'
    | 'sent'
    | 'failed'
    | 'unknown'
  channel_message_url: string
  channel_title: string
  channel_error: string
}
export type AnnouncementHistory = {
  items: AnnouncementRecord[]
  total: number
  page: number
  page_size: number
}
