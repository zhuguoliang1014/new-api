import { api } from '@/lib/api'
import type {
  LuckyBagStatusResponse,
  LuckyBagHistoryResponse,
  OpenResult,
} from './types'

interface ApiResponse<T> {
  success: boolean
  message?: string
  data: T
}

export async function getLuckyBagStatus(): Promise<ApiResponse<LuckyBagStatusResponse>> {
  const res = await api.get('/api/lucky-bag/status')
  return res.data
}

export async function openLuckyBag(): Promise<ApiResponse<OpenResult>> {
  const res = await api.post('/api/lucky-bag/open')
  return res.data
}

export async function getLuckyBagHistory(
  page = 1,
  size = 30,
): Promise<ApiResponse<LuckyBagHistoryResponse>> {
  const res = await api.get('/api/lucky-bag/history', { params: { page, size } })
  return res.data
}
