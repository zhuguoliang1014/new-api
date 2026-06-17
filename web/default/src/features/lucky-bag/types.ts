// Lucky Bag v2 — 手动开盒模型

export interface EligibilityInfo {
  yesterday_spend_quota: number    // quota 单位（500000 = $1）
  eligible_slots: number           // 今日总机会
  used_slots: number               // 今日已开盒次数
  remaining_slots: number          // 剩余次数
  today_won_quota: number          // 今日累计中奖 quota
  daily_won_limit_quota: number    // 每日上限 quota（5000000 = $10）
  daily_limit_reached: boolean     // 是否已达上限
  next_refresh_unix: number        // 下次资格刷新时间（unix 秒）
}

export interface PrizeRange {
  min_quota: number
  max_quota: number
}

export interface Tier {
  min_usd: number
  slots: number
}

export interface LuckyBagStatusResponse {
  eligibility: EligibilityInfo
  prize_range: PrizeRange
  tiers: Tier[]
}

export interface OpenResult {
  prize_quota: number
  today_won_quota: number
  used_slots: number
  remaining_slots: number
  daily_limit_reached: boolean
}

export interface LuckyBagOpenRecord {
  id: number
  prize_quota: number
  opened_at: number  // unix 秒
}

export interface LuckyBagHistoryResponse {
  records: LuckyBagOpenRecord[]
  total: number
  page: number
  size: number
}
