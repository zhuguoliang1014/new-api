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
import { api } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

export type UserTokenRank = {
  rank: number
  name: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  is_me: boolean
}

export type DailyUserRankings = {
  date: string
  timezone: string
  generated_at: number
  next_reset_at: number
  total_tokens: number
  participants: number
  rows: UserTokenRank[]
  me: UserTokenRank | null
  limit: number
}

export async function getUserRankings(
  date?: string
): Promise<DailyUserRankings> {
  const response = await api.get('/api/rankings/users', { params: { date } })
  return requireServerSuccess(response.data).data
}
