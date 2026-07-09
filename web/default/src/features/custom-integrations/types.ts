export type CustomIntegrationSettings = {
  WechatBotEnabled: boolean
  WechatBotUserId: string
  WechatBotGroupIds: string
  'channel_health_alert_setting.enabled': boolean
  'channel_health_alert_setting.check_interval_seconds': number
  'channel_health_alert_setting.wechat_group_ids': string
  'channel_health_alert_setting.rules': ChannelHealthAlertRule[]
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

export type ChannelHealthAlertScope = {
  channel_ids?: number[]
  models?: string[]
  groups?: string[]
}

export type ChannelHealthAlertCondition = {
  and?: ChannelHealthAlertCondition[]
  or?: ChannelHealthAlertCondition[]
  metric?: string
  op?: string
  value?: number
}

export type ChannelHealthAlertRule = {
  id: string
  name: string
  enabled: boolean
  window_minutes: number
  cooldown_minutes: number
  scope?: ChannelHealthAlertScope
  condition: ChannelHealthAlertCondition
}
