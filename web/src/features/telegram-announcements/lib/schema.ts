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
import { z } from 'zod'

export const announcementSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Required')
    .refine((value) => [...value].length <= 120, 'Title is too long'),
  body: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(4096, 'Announcement is too long'),
  pin: z.boolean(),
  publish_to_channel: z.boolean(),
})
const httpsURL = z
  .string()
  .trim()
  .url('Invalid URL')
  .refine((value) => {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }, 'Use an HTTPS link')
export const templateSchema = z.object({
  footer: z.string().trim().max(300, 'Footer is too long'),
  channel_url: httpsURL,
  contact_url: httpsURL,
  channel_label: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(24, 'Button label is too long'),
  contact_label: z
    .string()
    .trim()
    .min(1, 'Required')
    .max(24, 'Button label is too long'),
})
