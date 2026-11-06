import { useQuery } from '@tanstack/react-query'

import { requireServerSuccess } from '@/lib/server-error-message'

import { getTopupInfo } from '../api'

export function useTopupInfoQuery(enabled = true) {
  return useQuery({
    queryKey: ['wallet', 'topup-info'],
    queryFn: async () => requireServerSuccess(await getTopupInfo()),
    staleTime: 60 * 1000,
    enabled,
  })
}
