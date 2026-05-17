import { useState, useEffect, useCallback } from 'react'
import i18next from 'i18next'
import { toast } from 'sonner'
import { getSubscriptionHistory } from '@/features/subscriptions/api'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'

export function useSubscriptionHistory() {
  const [records, setRecords] = useState<UserSubscriptionRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(false)

  const fetchHistory = useCallback(async () => {
    setLoading(true)
    try {
      const response = await getSubscriptionHistory(page, pageSize)
      if (response.success && response.data) {
        setRecords(response.data.items || [])
        setTotal(response.data.total || 0)
      } else {
        toast.error(
          response.message || i18next.t('Failed to load subscription history')
        )
        setRecords([])
        setTotal(0)
      }
    } catch {
      toast.error(i18next.t('Failed to load subscription history'))
      setRecords([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
  }, [])

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize)
    setPage(1)
  }, [])

  return {
    records,
    total,
    page,
    pageSize,
    loading,
    handlePageChange,
    handlePageSizeChange,
  }
}
