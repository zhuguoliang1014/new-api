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
import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, expect, test, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { MySubscriptionsCard } from '../my-subscriptions-card'

afterEach(async () => {
  await i18next.changeLanguage('en')
})

test.each([
  {
    language: 'en',
    expected: 'Matching subscriptions first, then wallet balance',
  },
  { language: 'zh', expected: '优先使用匹配的订阅，均不满足时使用余额' },
])(
  'shows the fixed fallback policy with a legacy preference in $language',
  async ({ language, expected }) => {
    i18next.addResourceBundle('zh', 'translation', zh.translation)
    await i18next.changeLanguage(language)
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/subscription/self'
            ? {
                billing_preference: 'subscription_only',
                subscriptions: [],
                all_subscriptions: [],
              }
            : [],
      },
    }))
    render(<MySubscriptionsCard />)
    expect(await screen.findByText(expected)).toBeVisible()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  }
)
