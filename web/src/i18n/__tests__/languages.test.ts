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
import { describe, expect, test } from 'vitest'

import {
  INTERFACE_LANGUAGE_OPTIONS,
  convertDetectedLanguage,
  normalizeInterfaceLanguage,
  toIntlLocale,
} from '../languages'

describe('supported interface languages', () => {
  test('offers only Simplified Chinese and English', () => {
    expect(INTERFACE_LANGUAGE_OPTIONS.map((language) => language.code)).toEqual(
      ['zhCN', 'en']
    )
  })

  test.each([
    'zh',
    'zh-CN',
    'zhCN',
    'zh_TW',
    'zhTW',
    'zh-HK',
    'zh-Hant-TW',
    ' ZH-cn ',
  ])(
    'uses Simplified Chinese for browser or saved preference %s',
    (language) => {
      expect(convertDetectedLanguage(language)).toBe('zhCN')
      expect(normalizeInterfaceLanguage(language)).toBe('zhCN')
    }
  )

  test.each(['en', 'en-US', 'en_GB', 'fr-FR', 'ru', 'ja', 'vi', '', 'unknown'])(
    'uses English for browser or saved preference %s',
    (language) => {
      expect(convertDetectedLanguage(language)).toBe('en')
      expect(normalizeInterfaceLanguage(language)).toBe('en')
    }
  )

  test('uses English when the saved language is absent', () => {
    expect(normalizeInterfaceLanguage()).toBe('en')
    expect(normalizeInterfaceLanguage(null)).toBe('en')
  })

  test.each([
    ['zhCN', 'zh-CN'],
    ['zhTW', 'zh-TW'],
    ['en', 'en'],
    ['fr', 'fr'],
    ['ja', 'ja'],
    ['ru', 'ru'],
    ['vi', 'vi'],
    ['invalid_locale!', undefined],
  ])(
    'keeps valid Intl formatting and legacy %s data supported',
    (language, expected) => {
      expect(toIntlLocale(language)).toBe(expected)
    }
  )
})
