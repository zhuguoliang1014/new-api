import type { TopupInfo } from '@/features/wallet/types'

export type * from '@/features/wallet/types'

export interface MyWalletTopupInfo extends TopupInfo {
  referral_reward_percent?: number
  enable_hupijiao_topup?: boolean
  hupijiao_min_topup?: number
  hupijiao_min_recharge_amount?: number
  hupijiao_price?: number
  hupijiao_amount_options?: number[] | string
  hupijiao_discount?: Record<number, number> | string
}

export type HupijiaoPaymentData = {
  order_id?: string
  qrcode_url?: string
  pay_url?: string
  trade_no?: string
  create_time?: number
  paid?: boolean
}

export type HupijiaoPaymentResponse = {
  success?: boolean
  message?: string
  data?: HupijiaoPaymentData
}

export type HupijiaoOrderStatusResponse = {
  success?: boolean
  message?: string
  data?: {
    status?: string
    paid?: boolean
  }
}
