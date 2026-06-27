import { api } from '@/lib/api'
import type {
  ApiResponse,
  WorldCupChoice,
  WorldCupHistoryData,
  WorldCupStatusData,
} from './types'

export async function getWorldCupStatus(options?: {
  type?: string
}): Promise<ApiResponse<WorldCupStatusData>> {
  const res = await api.get('/api/world-cup/status', {
    params: options?.type ? { type: options.type } : undefined,
    disableDuplicate: true,
  })
  return res.data
}

export async function predictWorldCup(data: {
  match_id: string
  date: string
  choice: WorldCupChoice
}): Promise<
  ApiResponse<{ prediction: WorldCupStatusData['predictions'][string] }>
> {
  const res = await api.post('/api/world-cup/predict', data)
  return res.data
}

export async function getWorldCupHistory(
  page = 1,
  size = 30
): Promise<ApiResponse<WorldCupHistoryData>> {
  const res = await api.get('/api/world-cup/history', {
    params: { page, size },
  })
  return res.data
}
