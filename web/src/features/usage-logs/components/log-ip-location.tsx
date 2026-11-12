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
import { Globe, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'

import { getLogIPLocation, queryLogIPLocation } from '../api'
import { formatIPLocation } from '../lib/ip-location'

export function LogIPLocation(props: { ip: string; enabled: boolean }) {
  const { t, i18n } = useTranslation()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const client = useQueryClient()
  const queryKey = ['log-ip-location', userId, props.ip]
  const cache = useQuery({
    queryKey,
    queryFn: ({ signal }) => getLogIPLocation(props.ip, signal),
    enabled: props.enabled && !!props.ip,
    staleTime: 0,
    retry: false,
    // Opening a dialog should silently show the query action on a cache failure.
    meta: { errorToast: false },
  })
  const lookup = useMutation({
    mutationFn: (target: { ip: string; userId: number | undefined }) =>
      queryLogIPLocation(target.ip),
    onSuccess: (data, target) =>
      client.setQueryData(['log-ip-location', target.userId, target.ip], data),
  })
  const location = cache.data?.location
  const busy = cache.isFetching || lookup.isPending
  const unavailable = cache.data?.query_available === false

  return (
    <span className='inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1'>
      <span className='inline-flex min-w-0 items-center gap-1 break-all'>
        <Globe className='size-3 shrink-0 text-amber-500' aria-hidden='true' />
        {props.ip}
      </span>
      {location && (
        <span className='text-muted-foreground font-sans' aria-live='polite'>
          {formatIPLocation(
            location,
            i18n.resolvedLanguage || i18n.language,
            t
          )}
        </span>
      )}
      <Button
        type='button'
        variant='link'
        size='xs'
        className='h-5 px-0 font-sans text-xs'
        disabled={busy || unavailable}
        aria-busy={busy}
        title={unavailable ? t('IP location query is unavailable') : undefined}
        onClick={() => lookup.mutate({ ip: props.ip, userId })}
      >
        {busy && <Loader2 className='size-3 animate-spin' aria-hidden='true' />}
        {busy ? t('Querying...') : t('Query IP location')}
      </Button>
    </span>
  )
}
