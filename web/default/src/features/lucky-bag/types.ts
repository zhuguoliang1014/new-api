export interface LuckyBagActivity {
  id: number
  draw_date: string
  slot_hour: number   // 0~23
  slot_minute: number // 0~59
  min_quota: number
  max_quota: number
  status: 'pending' | 'drawn'
  // 第1名
  winner_user_id: number
  winner_name: string
  winner_quota: number
  winner_code: string
  // 第2名
  winner2_user_id: number
  winner2_name: string
  winner2_quota: number
  winner2_code: string
  // 第3名
  winner3_user_id: number
  winner3_name: string
  winner3_quota: number
  winner3_code: string

  drawn_at: number
  created_at: number

  // 仅历史记录中当前用户中奖时有值
  my_winner_rank?: number   // 0=未中奖，1/2/3
  winner_code_status?: number   // 1=未使用 3=已使用
  winner2_code_status?: number
  winner3_code_status?: number
}

export interface DrawSlot {
  hour: number
  minute: number
}

export interface LuckyBagEntry {
  id: number
  activity_id: number
  user_id: number
  weight: number
  created_at: number
}

export interface LuckyBagResultCard {
  activity: LuckyBagActivity
  is_winner: boolean
  winner_rank: number // 0=未中奖，1/2/3
  winner_viewed: boolean
}

export interface EligibilityInfo {
  yesterday_spend_quota: number // quota 单位，500000 = $1
  eligible_slots: number        // 今日可参与场次数 (0/1/2/3/5)
  used_slots: number            // 今日已报名场次数
  remaining_slots: number       // 剩余可参与次数
  today_won_quota: number       // 今日已中奖 quota 总和
  daily_limit_reached: boolean  // 是否已达每日 $10 上限
}

export interface LuckyBagStatusResponse {
  today_activities: LuckyBagActivity[]
  next_activity: LuckyBagActivity | null
  entered: boolean
  weight: number
  participant_count: number
  result_cards: LuckyBagResultCard[] | null
  draw_slots: DrawSlot[]
  today_finished: boolean
  eligibility: EligibilityInfo | null
}

export interface LuckyBagHistoryResponse {
  activities: LuckyBagActivity[]
  total: number
  page: number
  size: number
}
