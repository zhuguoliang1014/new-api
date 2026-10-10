import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type {
  PlanRecord,
  SubscriptionPlan,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import ja from '@/i18n/locales/ja.json'
import ru from '@/i18n/locales/ru.json'
import viLocale from '@/i18n/locales/vi.json'
import zhTW from '@/i18n/locales/zh-TW.json'
import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import type { MyWalletTopupInfo } from '../../types'
import { AvailablePlansCard } from '../available-plans-card'

const now = 1800000000
const originalConfig = useSystemConfigStore.getState().config
const topupInfo: MyWalletTopupInfo = {
  enable_hupijiao_topup: true,
  enable_online_topup: false,
  enable_stripe_topup: false,
  pay_methods: [],
  min_topup: 1,
  stripe_min_topup: 1,
  amount_options: [],
  discount: {},
}

function plan(overrides: Partial<SubscriptionPlan> = {}): PlanRecord {
  return {
    plan: {
      id: 1,
      title: '苍穹版',
      subtitle: '仅限 GPT 模型',
      price_cny: 2000,
      price_amount: 280,
      currency: 'USD',
      duration_unit: 'month',
      duration_value: 1,
      quota_reset_period: 'never',
      enabled: true,
      allow_balance_pay: true,
      allow_wallet_overflow: true,
      sort_order: 0,
      max_purchase_per_user: 0,
      total_amount: 3900000000,
      ...overrides,
    },
  }
}

async function renderPlans(
  plans: PlanRecord[],
  options: {
    language?: string
    purchases?: UserSubscriptionRecord[]
    paymentEnabled?: boolean
  } = {}
) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/subscription/plans') {
      return { data: { success: true, data: plans } }
    }
    if (url === '/api/subscription/self') {
      return {
        data: {
          success: true,
          data: {
            subscriptions: [],
            all_subscriptions: options.purchases || [],
          },
        },
      }
    }
    throw new Error(`Unexpected request: ${url}`)
  })
  const i18n = createInstance()
  await i18n.init({
    lng: options.language || 'en',
    fallbackLng: 'en',
    resources: { en, zhCN: zh, zhTW, fr, ja, ru, vi: viLocale },
    initAsync: false,
  })
  const result = render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <AvailablePlansCard
          topupInfo={options.paymentEnabled === false ? null : topupInfo}
        />
      </TooltipProvider>
    </I18nextProvider>
  )
  await screen.findByText(
    plans.length ? plans[0].plan.title : 'No plans available'
  )
  return { ...result, i18n }
}

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(now * 1000)
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG },
  })
})

afterEach(() => {
  cleanup()
  useSystemConfigStore.getState().setConfig(originalConfig)
})

it('lays out cards by viewport width and keeps price cycles and action rows compact', async () => {
  const { container } = await renderPlans([
    plan(),
    plan({ id: 2, title: '凌云版', price_cny: 1000, total_amount: 1925000000 }),
    plan({ id: 3, title: '逐光版', price_cny: 500, total_amount: 965000000 }),
  ])
  expect(
    container.querySelector('[data-slot="subscription-plan-grid"]')
  ).toHaveClass(
    'grid-cols-1',
    'sm:grid-cols-2',
    'md:grid-cols-1',
    'lg:grid-cols-2',
    'xl:grid-cols-3',
    'min-[90rem]:grid-cols-4'
  )
  const card = screen.getByRole('article', { name: '苍穹版' })
  expect(within(card).getByText('¥2,000')).toBeVisible()
  expect(within(card).getByText('$7,800')).toBeVisible()
  expect(within(card).getByText('/ 1 months')).toHaveClass('whitespace-nowrap')
  expect(
    within(card).getByRole('button', { name: 'Subscribe Now' })
  ).toHaveClass('min-h-11')
  expect(within(card).getByText('Available Quota')).toBeVisible()
  expect(within(card).getByText('Recommended')).toBeVisible()
  expect(
    within(screen.getByRole('article', { name: '凌云版' })).queryByText(
      'Recommended'
    )
  ).toBeNull()
  expect(screen.getAllByRole('article')).toHaveLength(3)
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  expect(
    card.querySelector('[data-slot="plan-provider-icon"] svg')
  ).toBeInTheDocument()
})

it('keeps long plan names, descriptions and details contained without losing their full text', async () => {
  const title = 'A subscription plan with a very long descriptive name'
  const subtitle =
    'A long description of the models included in this subscription plan'
  await renderPlans([plan({ title, subtitle })])
  const card = screen.getByRole('article', { name: title })
  expect(within(card).getByRole('heading', { name: title })).toHaveClass(
    'break-words'
  )
  expect(within(card).getByRole('heading', { name: title })).toHaveAttribute(
    'title',
    title
  )
  expect(within(card).getByText(subtitle)).toHaveClass(
    'line-clamp-2',
    'break-words'
  )
  expect(within(card).getByText(subtitle)).toHaveAttribute('title', subtitle)
  expect(within(card).queryByText('Recommended')).not.toBeInTheDocument()
})

it('opens the existing purchase dialog for the selected plan using the keyboard', async () => {
  await renderPlans([plan()])
  const button = screen.getByRole('button', { name: 'Subscribe Now' })
  button.focus()
  await userEvent.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog', {
    name: 'Purchase Subscription',
  })
  expect(within(dialog).getByText('苍穹版')).toBeVisible()
  expect(within(dialog).getByText('¥2,000')).toBeVisible()
  expect(within(dialog).getByRole('button', { name: 'Alipay' })).toBeEnabled()
})

it.each([
  {
    state: 'upcoming',
    fields: { starts_at: now + 3600 },
    label: 'Starts in 01:00:00',
  },
  { state: 'ended', fields: { expires_at: now - 1 }, label: 'Sale Ended' },
])(
  'disables $state plans and preserves their sale message',
  async ({ fields, label }) => {
    await renderPlans([plan(fields)])
    expect(screen.getByRole('button', { name: label })).toBeDisabled()
  }
)

it('keeps purchase limits visible and disables plans whose limit has been reached', async () => {
  await renderPlans([plan({ max_purchase_per_user: 1 })], {
    purchases: [
      {
        subscription: {
          id: 1,
          user_id: 1,
          plan_id: 1,
          status: 'expired',
          start_time: now - 100,
          end_time: now - 1,
          amount_total: 100,
          amount_used: 100,
        },
      },
    ],
  })
  expect(screen.getByText('Purchased 1 of 1')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Limit Reached' })).toBeDisabled()
})

it('keeps the administrator payment-disabled message on an unavailable purchase button', async () => {
  await renderPlans([plan()], { paymentEnabled: false })
  expect(
    screen.getByRole('button', { name: 'Online payment disabled by admin' })
  ).toBeDisabled()
})

it('shows unlimited quota and omits sold-count placeholders when there are no sales', async () => {
  await renderPlans([plan({ total_amount: 0 })])
  const card = screen.getByRole('article', { name: '苍穹版' })
  expect(within(card).getByText('Unlimited')).toBeVisible()
  expect(within(card).queryByText(/Sold/)).not.toBeInTheDocument()
})

it('shows the empty state without rendering purchase actions when no plans are available', async () => {
  await renderPlans([])
  expect(screen.queryByRole('article')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Subscribe Now' })
  ).not.toBeInTheDocument()
})

it.each(['zhCN', 'zhTW', 'en', 'fr', 'ja', 'ru', 'vi', 'invalid_locale!'])(
  'preserves decimal CNY and USD prices and quota amounts in %s',
  async (language) => {
    await renderPlans(
      [
        plan({ price_cny: 2000.5, total_amount: 3900062500 }),
        plan({ id: 2, title: 'USD plan', price_cny: 0, price_amount: 10.25 }),
      ],
      { language }
    )
    expect(screen.getByRole('article', { name: '苍穹版' })).toHaveTextContent(
      /2[,.\s\u00a0\u202f]?000[.,]5/
    )
    expect(screen.getByRole('article', { name: '苍穹版' })).toHaveTextContent(
      /7[,.\s\u00a0\u202f]?800[.,]13/
    )
    expect(screen.getByRole('article', { name: 'USD plan' })).toHaveTextContent(
      /\$10[.,]25/
    )
  }
)

it('updates localized labels and number separators when the interface language changes', async () => {
  const { i18n } = await renderPlans([plan({ price_cny: 2000.5 })], {
    language: 'zhCN',
  })
  expect(screen.getByText('可用额度')).toBeVisible()
  expect(screen.getByText('不限次数')).toBeVisible()
  expect(screen.getByText('¥2,000.5')).toBeVisible()
  await act(async () => {
    await i18n.changeLanguage('fr')
  })
  expect(screen.getByText('Quota disponible')).toBeVisible()
  expect(screen.getByRole('article', { name: '苍穹版' })).toHaveTextContent(
    /2[\s\u00a0\u202f]000,5/
  )
})

it('updates quota display currency without converting the CNY purchase price again', async () => {
  await renderPlans([plan()])
  act(() => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 7,
      },
    })
  })
  const card = screen.getByRole('article', { name: '苍穹版' })
  expect(within(card).getByText('¥54,600')).toBeVisible()
  expect(within(card).getByText('¥2,000')).toBeVisible()
})
