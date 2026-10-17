import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import * as paymentLib from '@/features/wallet/lib'
import { api } from '@/lib/api'

import { useMyWallet } from '../use-my-wallet'

const info = {
  enable_online_topup: true,
  enable_hupijiao_topup: true,
  enable_stripe_topup: false,
  min_topup: 10,
  stripe_min_topup: 1,
  pay_methods: [{ type: 'alipay', name: 'Alipay' }],
  amount_options: [30, 50],
  discount: { '50': 0.95 },
  hupijiao_amount_options: [100],
}

afterEach(() => vi.restoreAllMocks())

it.each([true, false])(
  'uses native amount and checkout APIs when Epay is enabled (old gateway enabled: %s)',
  async (oldGatewayEnabled) => {
    vi.spyOn(api, 'get').mockImplementation(async (url) => ({
      data: {
        success: true,
        data:
          url === '/api/user/topup/info'
            ? { ...info, enable_hupijiao_topup: oldGatewayEnabled }
            : {},
      },
    }))
    const post = vi.spyOn(api, 'post').mockImplementation(async (url) => ({
      data:
        url === '/api/user/amount'
          ? { message: 'success', data: '30.00' }
          : {
              message: 'success',
              url: 'https://pay.example/submit.php',
              data: { out_trade_no: 'native-order' },
            },
    }))
    const submit = vi
      .spyOn(paymentLib, 'submitPaymentForm')
      .mockImplementation(() => {})
    const client = new QueryClient()
    const { result } = renderHook(useMyWallet, {
      wrapper: (props) => (
        <QueryClientProvider client={client}>
          {props.children}
        </QueryClientProvider>
      ),
    })
    await waitFor(() => expect(result.current.topupAmount).toBe(30))
    await waitFor(() => expect(result.current.paymentAmount).toBe(30))
    expect(result.current.presetAmounts.map((p) => p.value)).toEqual([30, 50])
    await act(async () => {
      await result.current.handlePaymentConfirm()
    })
    expect(post).toHaveBeenCalledWith(
      '/api/user/pay',
      { amount: 30, payment_method: 'alipay' },
      { skipBusinessError: true }
    )
    expect(submit).toHaveBeenCalledWith('https://pay.example/submit.php', {
      out_trade_no: 'native-order',
    })
    expect(
      post.mock.calls.some(([url]) => String(url).includes('hupijiao'))
    ).toBe(false)
  }
)
