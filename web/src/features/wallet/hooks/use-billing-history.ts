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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { useIsAdmin } from '@/hooks/use-admin'
import { useDebounce } from '@/hooks/use-debounce'
import { getSelf } from '@/lib/api'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import {
  getUserBillingHistory,
  getAllBillingHistory,
  completeOrder,
  closeOrder,
  resumeOrder,
} from '../api'

interface UseBillingHistoryOptions {
  initialPage?: number
  initialPageSize?: number
  userOnly?: boolean
}

export function useBillingHistory(options: UseBillingHistoryOptions = {}) {
  const userId = useAuthStore((state) => state.auth.user?.id)
  const admin = useIsAdmin()
  const isAdmin = admin && !options.userOnly
  const [page, setPage] = useState(options.initialPage ?? 1)
  const [pageSize, setPageSize] = useState(options.initialPageSize ?? 10)
  const [keyword, setKeyword] = useState('')
  const debouncedKeyword = useDebounce(keyword)
  const queryClient = useQueryClient()
  const history = useQuery({
    queryKey: [
      'billing-history',
      userId,
      isAdmin,
      page,
      pageSize,
      debouncedKeyword,
    ],
    queryFn: async () => {
      const response = isAdmin
        ? await getAllBillingHistory(page, pageSize, debouncedKeyword)
        : await getUserBillingHistory(page, pageSize, debouncedKeyword)
      return requireServerSuccess(response).data ?? { items: [], total: 0 }
    },
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  })
  const action = useMutation({
    mutationFn: async (request: {
      tradeNo: string
      action: 'complete' | 'close' | 'pay'
    }) => {
      if (request.action === 'complete') {
        if (!isAdmin) throw new Error(i18next.t('Admin access required'))
        return requireServerSuccess(
          await completeOrder({ trade_no: request.tradeNo })
        )
      }
      if (request.action === 'close') {
        return requireServerSuccess(await closeOrder(request.tradeNo, isAdmin))
      }
      return requireServerSuccess(await resumeOrder(request.tradeNo))
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['billing-history'] })
    },
    onError: (error) =>
      handleServerError(error, i18next.t('Order operation failed')),
  })
  const refetchHistory = history.refetch
  const refresh = useCallback(() => {
    void refetchHistory()
  }, [refetchHistory])
  const handleCompleteOrder = async (tradeNo: string) => {
    try {
      await action.mutateAsync({ tradeNo, action: 'complete' })
      toast.success(i18next.t('Payment verified and order settled'))
      if (options.userOnly) await getSelf()
      return true
    } catch {
      return false
    }
  }
  return {
    records: history.data?.items ?? [],
    total: history.data?.total ?? 0,
    page,
    pageSize,
    keyword,
    isAdmin,
    loading: history.isPending,
    completing: action.isPending,
    busyOrder: action.isPending ? action.variables?.tradeNo : undefined,
    handlePageChange: setPage,
    handlePageSizeChange: (value: number) => {
      setPageSize(value)
      setPage(1)
    },
    handleSearch: (value: string) => {
      setKeyword(value)
      setPage(1)
    },
    handleCompleteOrder,
    runAction: action.mutateAsync,
    refresh,
  }
}
