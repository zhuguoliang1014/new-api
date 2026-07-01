export type CustomIntegrationSettings = {
  WechatBotEnabled: boolean
  WechatBotUserId: string
  WechatBotGroupIds: string
  /** 虎皮椒专用充值定价（独立 Option，与支付网关无关） */
  HupijiaoPrice: number
  HupijiaoAmountOptions: string
  HupijiaoAmountDiscount: string
  HupijiaoEnabled: boolean
  HupijiaoAppId: string
  HupijiaoAppSecret: string
  HupijiaoApiUrl: string
  HupijiaoNotifyUrl: string
  HupijiaoReturnUrl: string
  HupijiaoMinTopUp: number
  HupijiaoInviteRewardRatio: number
}
