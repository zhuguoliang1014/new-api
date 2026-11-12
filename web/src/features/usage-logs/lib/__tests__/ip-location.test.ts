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
import { createInstance } from 'i18next'
import { beforeAll, expect, test } from 'vitest'

import en from '@/i18n/locales/en.json'
import zh from '@/i18n/locales/zh.json'

import { formatIPLocation, type IPLocation } from '../ip-location'

const i18n = createInstance()
const location: IPLocation = {
  ip: '8.8.8.8',
  country: 'China',
  country_code: 'CN',
  region: 'Beijing',
  city: 'Beijing',
  network: 'China Telecom',
}
beforeAll(async () => {
  await i18n.init({
    lng: 'zhCN',
    resources: { zhCN: zh, en },
    interpolation: { escapeValue: false },
  })
})

test('Chinese regions and common carrier names use compact local labels', () => {
  expect(formatIPLocation(location, 'zhCN', i18n.t)).toBe('北京·电信')
  expect(
    formatIPLocation(
      {
        ...location,
        region: 'Guangdong Province',
        city: 'Guangzhou',
        network: 'China Mobile Communications Group Co., Ltd.',
      },
      'zhCN',
      i18n.t
    )
  ).toBe('广东·移动')
  expect(
    formatIPLocation(
      { ...location, region: 'Henan', network: 'China Unicom' },
      'zhCN',
      i18n.t
    )
  ).toBe('河南·联通')
})

test('unknown networks retain their original names and missing fields add no separators', () => {
  expect(
    formatIPLocation(
      { ...location, network: 'Example Network' },
      'zhCN',
      i18n.t
    )
  ).toBe('北京·Example Network')
  expect(formatIPLocation({ ...location, network: '' }, 'zhCN', i18n.t)).toBe(
    '北京'
  )
  expect(
    formatIPLocation(
      { ...location, country: '', country_code: '', region: '', city: '' },
      'zhCN',
      i18n.t
    )
  ).toBe('China Telecom')
})

test('international addresses include country and city without renaming unrelated telecom providers', () => {
  expect(
    formatIPLocation(
      {
        ...location,
        country: 'United States',
        country_code: 'US',
        city: 'New York',
        region: 'New York',
        network: 'Example Telecom',
      },
      'zhCN',
      i18n.t
    )
  ).toBe('美国 New York·Example Telecom')
})

test('IP9 Chinese data preserves province and city and avoids duplicate municipality names', () => {
  expect(
    formatIPLocation(
      {
        ...location,
        ip: '111.58.230.113',
        country: '中国',
        region: '广西',
        city: '南宁',
        network: '中国移动',
      },
      'zhCN',
      i18n.t
    )
  ).toBe('广西南宁·移动')
  expect(
    formatIPLocation(
      {
        ...location,
        country: '中国',
        region: '北京',
        city: '北京',
        network: '中国电信',
      },
      'zhCN',
      i18n.t
    )
  ).toBe('北京·电信')
  expect(
    formatIPLocation(
      {
        ...location,
        country: '中国',
        region: '广西',
        city: '',
        network: '中国移动',
      },
      'zhCN',
      i18n.t
    )
  ).toBe('广西·移动')
})

test('IP9 IPv6 data with no city displays the country and available network', () => {
  expect(
    formatIPLocation(
      {
        ...location,
        country: '美国',
        country_code: 'US',
        region: '',
        city: '',
        network: 'Cloudflare',
      },
      'zhCN',
      i18n.t
    )
  ).toBe('美国·Cloudflare')
})
