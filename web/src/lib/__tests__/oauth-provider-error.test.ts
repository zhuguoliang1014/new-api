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
import i18next from 'i18next'
import { afterEach, expect, it } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'
import {
  createServerError,
  getServerErrorMessage,
} from '@/lib/server-error-message'

afterEach(async () => {
  await i18next.changeLanguage('en')
  i18next.removeResourceBundle('zhCN', 'translation')
  i18next.removeResourceBundle('en', 'translation')
})

it.each([
  [
    '{{provider}} login service returned an error (HTTP {{status}}). Sign-in through this provider is temporarily unavailable. Please restart sign-in later or use another sign-in method.',
    '妖火论坛登录接口返回异常（HTTP 567）',
  ],
  [
    '{{provider}} login service returned an invalid response. Sign-in through this provider is temporarily unavailable. Please restart sign-in later or use another sign-in method.',
    '妖火论坛登录接口返回了无效响应',
  ],
])(
  'translates provider failure %s with its name and actionable guidance',
  async (key, expected) => {
    i18next.addResourceBundle('zhCN', 'translation', zh.translation)
    i18next.addResourceBundle('en', 'translation', en.translation)
    await i18next.changeLanguage('zhCN')
    const payload = {
      success: false,
      message_key: key,
      message_params: { provider: '妖火论坛', status: 567 },
    }
    const message = getServerErrorMessage(createServerError(payload))
    expect(message).toContain(expected)
    expect(message).toContain('使用其他登录方式')
    expect(message).not.toContain('{{')

    await i18next.changeLanguage('en')
    expect(getServerErrorMessage(payload)).toContain('妖火论坛 login service')
  }
)

it('keeps local internal failures separate from provider failures', () => {
  expect(
    getServerErrorMessage({
      code: 'AUTH_INTERNAL_ERROR',
      message: 'private database error',
    })
  ).toBe('Please try again later.')
})
