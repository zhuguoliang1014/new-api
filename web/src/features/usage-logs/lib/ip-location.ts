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

import { toIntlLocale } from '@/i18n/languages'

export interface IPLocation {
  ip: string
  country: string
  country_code: string
  region: string
  city: string
  network: string
}

// Geographic data aliases from the lookup service, not interface labels.
const CHINA_REGIONS: Record<string, string> = {
  anhui: '安徽',
  beijing: '北京',
  chongqing: '重庆',
  fujian: '福建',
  gansu: '甘肃',
  guangdong: '广东',
  guangxi: '广西',
  guizhou: '贵州',
  hainan: '海南',
  hebei: '河北',
  heilongjiang: '黑龙江',
  henan: '河南',
  hubei: '湖北',
  hunan: '湖南',
  'inner mongolia': '内蒙古',
  jiangsu: '江苏',
  jiangxi: '江西',
  jilin: '吉林',
  liaoning: '辽宁',
  ningxia: '宁夏',
  qinghai: '青海',
  shaanxi: '陕西',
  shandong: '山东',
  shanghai: '上海',
  shanxi: '山西',
  sichuan: '四川',
  tianjin: '天津',
  tibet: '西藏',
  xizang: '西藏',
  xinjiang: '新疆',
  yunnan: '云南',
  zhejiang: '浙江',
  'hong kong': '香港',
  macau: '澳门',
  macao: '澳门',
  taiwan: '台湾',
}

export function formatIPLocation(
  location: IPLocation,
  language: string,
  t: TFunction
): string {
  const locale = toIntlLocale(language) || 'en'
  const chinese = locale.startsWith('zh')
  let place = location.city || location.region || location.country
  if (chinese && location.country_code === 'CN') {
    const region = location.region
      .toLowerCase()
      .replace(/ (province|shi|sheng|autonomous region)$/i, '')
    if (/[\u3400-\u9fff]/.test(location.region)) {
      place = location.city.startsWith(location.region)
        ? location.city
        : location.region + location.city
    } else {
      place =
        CHINA_REGIONS[region] ||
        CHINA_REGIONS[location.city.toLowerCase()] ||
        place
    }
  } else if (
    location.country_code &&
    /^[A-Z]{2}$/.test(location.country_code)
  ) {
    const country = new Intl.DisplayNames([locale], { type: 'region' }).of(
      location.country_code
    )
    place = [country || location.country, location.city || location.region]
      .filter(Boolean)
      .join(' ')
  }
  let network = location.network
  if (location.country_code === 'CN') {
    if (/china\s*telecom|chinanet|中国电信/i.test(network)) {
      network = t('China Telecom')
    } else if (/china\s*unicom|cncgroup|中国联通/i.test(network)) {
      network = t('China Unicom')
    } else if (/china\s*mobile|cmcc|中国移动/i.test(network)) {
      network = t('China Mobile')
    }
  }
  return [place, network].filter(Boolean).join('·')
}
