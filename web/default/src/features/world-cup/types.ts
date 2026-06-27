export type WorldCupChoice = 'host' | 'draw' | 'guest'

export interface WorldCupMatch {
  team_id: string
  date: string
  date_time: string
  host_team_id: string
  guest_team_id: string
  host_team_name: string
  guest_team_name: string
  host_team_score: string
  guest_team_score: string
  match_status: string
  match_des: string
  match_type: string
  match_type_name: string
  match_type_des: string
  group_name: string
  host_team_logo_url: string
  guest_team_logo_url: string
}

export interface WorldCupScheduleDay {
  schedule_date: string
  schedule_date_format: string
  schedule_week: string
  schedule_current: string
  schedule_list: WorldCupMatch[]
}

export interface WorldCupSchedule {
  reason: string
  data: WorldCupScheduleDay[]
}

export interface WorldCupPrediction {
  id: number
  match_id: string
  match_date: string
  match_time: number
  match_type: string
  group_name: string
  host_team_name: string
  guest_team_name: string
  choice: WorldCupChoice
  status: 'pending' | 'won' | 'lost' | 'void'
  reward_quota: number
  streak_bonus_quota: number
  settled_at: number
  created_at: number
}

export interface WorldCupStatusData {
  schedule: WorldCupSchedule
  predictions: Record<string, WorldCupPrediction>
  eligible: boolean
}

export interface WorldCupHistoryData {
  records: WorldCupPrediction[]
  completed_schedule: WorldCupSchedule
  total: number
  page: number
  size: number
}

export interface ApiResponse<T> {
  success: boolean
  message?: string
  data?: T
}
