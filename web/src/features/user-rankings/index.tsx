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
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import utc from 'dayjs/plugin/utc'
import {
  ArrowRight,
  Crown,
  Medal,
  RefreshCw,
  ShieldCheck,
  Trophy,
  Users,
  Zap,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { StaticDataTable } from '@/components/data-table'
import { DatePicker } from '@/components/date-picker'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { PublicLayout } from '@/components/layout'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import dayjs from '@/lib/dayjs'
import { formatCompactNumber, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  getUserRankings,
  type DailyUserRankings,
  type UserTokenRank,
} from './api'

dayjs.extend(utc)

export function UserRankings() {
  const { t } = useTranslation()
  const search = useSearch({ from: '/rankings/' })
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.auth.user)
  const query = useQuery({
    queryKey: ['user-rankings', search.date ?? 'today', user?.id ?? 0],
    queryFn: () => getUserRankings(search.date),
    refetchInterval: 60_000,
    staleTime: 30_000,
    meta: { errorToast: false },
  })
  const today = dayjs().utcOffset(8).format('YYYY-MM-DD')
  const selectedDate = search.date ?? query.data?.date ?? today

  let content = (
    <div aria-label={t('Loading')} className='mt-8 space-y-5'>
      <Skeleton className='h-24 w-full' />
      <Skeleton className='h-72 w-full' />
    </div>
  )
  if (query.isError) {
    content = (
      <ErrorState
        title={t('Unable to load rankings')}
        description={t('Please try again later')}
        onRetry={() => void query.refetch()}
      />
    )
  } else if (query.data) {
    content = (
      <UserRankingsBoard
        key={query.data.date}
        data={query.data}
        signedIn={!!user}
      />
    )
  }

  return (
    <PublicLayout showMainContainer={false}>
      <main className='mx-auto max-w-6xl px-4 pt-24 pb-12 sm:px-8'>
        <div className='mb-9 flex flex-wrap items-center justify-between gap-4 border-b pb-4'>
          <div className='flex items-center gap-2 text-sm font-medium'>
            <Trophy
              aria-hidden
              className='size-4 text-amber-600 dark:text-amber-400'
            />
            {t('Token leaderboard')}
          </div>
          <Button
            variant='ghost'
            size='sm'
            render={<Link to='/rankings' search={{ view: 'models' }} />}
          >
            {t('Model rankings')}
            <ArrowRight aria-hidden className='size-4' />
          </Button>
        </div>
        <header className='flex flex-col justify-between gap-6 md:flex-row md:items-end'>
          <div>
            <p className='mb-3 text-xs font-semibold tracking-[0.2em] text-amber-700 uppercase dark:text-amber-400'>
              {t('Every token counts')}
            </p>
            <h1 className='text-4xl font-semibold tracking-tight sm:text-5xl'>
              {t('Daily token leaderboard')}
            </h1>
            <p className='text-muted-foreground mt-4 max-w-xl text-sm leading-7'>
              {t('One day. All models. Ranked by tokens used.')}
            </p>
          </div>
          <div className='flex flex-wrap items-end gap-2'>
            <div className='text-muted-foreground space-y-2 text-xs'>
              <p>{t('Ranking date')} · UTC+8</p>
              <DatePicker
                className='bg-card h-9 w-40'
                ariaLabel={t('Ranking date')}
                selected={dayjs(selectedDate).toDate()}
                minDate={dayjs(today).subtract(29, 'day').toDate()}
                maxDate={dayjs(today).toDate()}
                onSelect={(date) => {
                  if (date) {
                    void navigate({
                      to: '/rankings',
                      search: {
                        view: 'users',
                        date: dayjs(date).format('YYYY-MM-DD'),
                      },
                    })
                  }
                }}
              />
            </div>
            <Button
              variant='outline'
              onClick={() =>
                void navigate({ to: '/rankings', search: { view: 'users' } })
              }
            >
              {t('Today')}
            </Button>
            <Button
              variant='outline'
              size='icon'
              aria-label={t('Refresh')}
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw
                aria-hidden
                className={cn('size-4', query.isFetching && 'animate-spin')}
              />
            </Button>
          </div>
        </header>
        {content}
      </main>
    </PublicLayout>
  )
}

export function UserRankingsBoard(props: {
  data: DailyUserRankings
  signedIn: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [visibleCount, setVisibleCount] = useState(20)
  const data = props.data
  const me = data.me
  const podium = data.rows.slice(0, 3)
  const total = Math.max(1, data.total_tokens)
  const dateIsToday = data.date === dayjs().utcOffset(8).format('YYYY-MM-DD')

  return (
    <div className='mt-8 space-y-8'>
      <section
        aria-label={t('Daily overview')}
        className='grid grid-cols-2 gap-5 border-y py-6 md:grid-cols-3'
      >
        <div>
          <p className='text-muted-foreground mb-2 flex items-center gap-2 text-xs'>
            <Zap aria-hidden className='size-4' />
            {t('Total tokens')}
          </p>
          <p
            title={formatNumber(data.total_tokens, locale)}
            className='text-3xl font-semibold tracking-tight tabular-nums'
          >
            {formatCompactNumber(data.total_tokens, locale)}
          </p>
        </div>
        <div>
          <p className='text-muted-foreground mb-2 flex items-center gap-2 text-xs'>
            <Users aria-hidden className='size-4' />
            {t('Ranked users')}
          </p>
          <p className='text-3xl font-semibold tracking-tight tabular-nums'>
            {formatNumber(data.participants, locale)}
          </p>
        </div>
        <div className='col-span-2 flex items-center gap-3 md:col-span-1 md:justify-end'>
          <span
            className={cn(
              'size-2 rounded-full',
              dateIsToday ? 'bg-emerald-500' : 'bg-slate-400'
            )}
          />
          <div>
            <p className='text-sm font-medium'>
              {dateIsToday ? t('Live daily ranking') : t('Historical ranking')}
            </p>
            <p className='text-muted-foreground mt-1 text-xs'>
              {t('Updated at {{time}}', {
                time: dayjs
                  .unix(data.generated_at)
                  .utcOffset(8)
                  .format('HH:mm'),
              })}{' '}
              · UTC+8
            </p>
          </div>
        </div>
      </section>
      {podium.length > 0 ? (
        <section
          aria-label={t('Top three')}
          className='grid grid-cols-3 items-end gap-2 pt-3 sm:gap-4 md:pt-5'
        >
          {podium.map((row) => (
            <PodiumCard key={row.rank} row={row} total={total} />
          ))}
        </section>
      ) : (
        <EmptyState
          icon={Trophy}
          title={t('The podium is waiting')}
          description={t('No token usage has been recorded for this day.')}
        />
      )}
      <section
        className='bg-muted/30 flex flex-wrap items-center justify-between gap-5 rounded-2xl border px-5 py-5 sm:px-7'
        aria-label={t('My ranking')}
      >
        <div className='flex items-center gap-4'>
          <span className='bg-background flex size-11 items-center justify-center rounded-full border'>
            <Trophy
              aria-hidden
              className='size-5 text-amber-600 dark:text-amber-400'
            />
          </span>
          <div>
            <h2 className='text-sm font-semibold'>{t('My ranking')}</h2>
            <p className='text-muted-foreground mt-1 text-xs'>
              {props.signedIn
                ? t('Your place in this day’s leaderboard')
                : t('Sign in to see your ranking')}
            </p>
          </div>
        </div>
        {!props.signedIn ? (
          <Button
            variant='outline'
            render={<Link to='/sign-in' search={{ redirect: '/rankings' }} />}
          >
            {t('Sign In')}
            <ArrowRight aria-hidden className='size-4' />
          </Button>
        ) : (
          <div className='flex items-center gap-7'>
            <p className='text-2xl font-semibold tabular-nums'>
              {me ? `#${me.rank}` : t('Not ranked')}
            </p>
            <div className='text-right'>
              <p className='font-semibold tabular-nums'>
                {formatNumber(me?.total_tokens ?? 0, locale)}
              </p>
              <p className='text-muted-foreground text-xs'>Token</p>
            </div>
          </div>
        )}
      </section>
      {data.rows.length > 0 && (
        <section aria-label={t('Leaderboard')}>
          <div className='mb-4 flex flex-wrap items-baseline justify-between gap-2'>
            <h2 className='text-lg font-semibold'>{t('Leaderboard')}</h2>
            <p className='text-muted-foreground text-xs'>
              {t('Top {{count}} · all models', {
                count: Math.min(data.limit, data.participants),
              })}
            </p>
          </div>
          <StaticDataTable<UserTokenRank>
            data={data.rows.slice(0, visibleCount)}
            getRowKey={(row) => row.rank}
            getRowClassName={(row) =>
              cn(row.is_me && 'bg-amber-50/60 dark:bg-amber-950/20')
            }
            columns={[
              {
                id: 'rank',
                header: t('Rank'),
                className: 'w-16',
                cell: (row) => (
                  <span
                    className={cn(
                      'font-mono text-sm tabular-nums',
                      row.rank <= 3 &&
                        'font-bold text-amber-700 dark:text-amber-400'
                    )}
                  >
                    {String(row.rank).padStart(2, '0')}
                  </span>
                ),
              },
              {
                id: 'user',
                header: t('User'),
                cell: (row) => (
                  <div className='flex items-center gap-3 py-2'>
                    <RankAvatar name={row.name} />
                    <span className='font-medium'>{row.name}</span>
                    {row.is_me && <Badge variant='outline'>{t('You')}</Badge>}
                  </div>
                ),
              },
              {
                id: 'input',
                header: t('Input tokens'),
                className: 'hidden text-right md:table-cell',
                cellClassName: 'hidden text-right tabular-nums md:table-cell',
                cell: (row) => formatNumber(row.input_tokens, locale),
              },
              {
                id: 'output',
                header: t('Output tokens'),
                className: 'hidden text-right md:table-cell',
                cellClassName: 'hidden text-right tabular-nums md:table-cell',
                cell: (row) => formatNumber(row.output_tokens, locale),
              },
              {
                id: 'total',
                header: t('Total tokens'),
                className: 'text-right',
                cellClassName: 'text-right tabular-nums font-semibold',
                cell: (row) => formatNumber(row.total_tokens, locale),
              },
              {
                id: 'share',
                header: t('Share'),
                className: 'hidden w-32 text-right sm:table-cell',
                cellClassName: 'hidden text-right sm:table-cell',
                cell: (row) => (
                  <div className='space-y-1'>
                    <span className='text-xs tabular-nums'>
                      {formatNumber((row.total_tokens / total) * 100, locale)}%
                    </span>
                    <div
                      aria-hidden
                      className='bg-muted ml-auto h-1 w-20 overflow-hidden rounded-full'
                    >
                      <div
                        className='h-full rounded-full bg-amber-500/75'
                        style={{
                          width: `${(row.total_tokens / total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                ),
              },
            ]}
          />
          {visibleCount < data.rows.length && (
            <div className='mt-4 text-center'>
              <Button
                variant='outline'
                onClick={() => setVisibleCount((count) => count + 20)}
              >
                {t('Show more')}
              </Button>
            </div>
          )}
        </section>
      )}
      <footer className='text-muted-foreground grid gap-4 border-t pt-6 text-xs leading-6 sm:grid-cols-[1fr_auto]'>
        <div>
          <h2 className='text-foreground mb-1 font-semibold'>
            {t('How rankings work')}
          </h2>
          <p>
            {t(
              'Input + output tokens from usage logs, across all models. No price weighting or extra cache-token addition.'
            )}
          </p>
          <p>
            {t(
              'Resets at 00:00 Beijing time. Refreshes every minute. The last 30 days are available.'
            )}
          </p>
          <p>
            {t(
              'Active regular users only. Ties are ordered by account ID. Only retained usage logs are counted.'
            )}
          </p>
        </div>
        <p className='flex items-start gap-2'>
          <ShieldCheck aria-hidden className='mt-1 size-4 shrink-0' />
          {t('Usernames are masked for privacy')}
        </p>
      </footer>
    </div>
  )
}

function RankAvatar(props: { name: string; large?: boolean }) {
  return (
    <Avatar
      className={cn(
        'size-8 shrink-0',
        props.large && 'size-10 ring-4 ring-background sm:size-16'
      )}
    >
      <AvatarFallback
        style={getUserAvatarStyle(props.name)}
        className={props.large ? 'text-lg font-medium sm:text-2xl' : ''}
      >
        {getUserAvatarFallback(props.name)}
      </AvatarFallback>
    </Avatar>
  )
}

function PodiumCard(props: { row: UserTokenRank; total: number }) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const row = props.row
  const gold = row.rank === 1
  let label = t('Bronze')
  let color =
    'border-orange-200 bg-orange-50/45 dark:border-orange-900/60 dark:bg-orange-950/15 order-3'
  let medalColor =
    'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300'
  if (gold) {
    label = t('Gold')
    color =
      'border-amber-300 bg-amber-50/70 dark:border-amber-700 dark:bg-amber-950/20 order-2 pb-8 sm:pb-10'
    medalColor =
      'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200'
  }
  if (row.rank === 2) {
    label = t('Silver')
    color =
      'border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/30 order-1'
    medalColor =
      'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
  }
  return (
    <article
      aria-label={label}
      className={cn(
        'relative flex min-w-0 flex-col items-center rounded-2xl border px-2 py-5 text-center sm:px-6 sm:py-7',
        color
      )}
    >
      <span
        className={cn(
          'mb-4 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold sm:mb-5 sm:gap-1.5 sm:px-3 sm:text-xs',
          medalColor
        )}
      >
        {gold ? (
          <Crown aria-hidden className='size-3.5' />
        ) : (
          <Medal aria-hidden className='size-3.5' />
        )}
        {label} · {String(row.rank).padStart(2, '0')}
      </span>
      <RankAvatar name={row.name} large />
      <p className='mt-4 max-w-full truncate text-sm font-semibold sm:text-base'>
        {row.name}
        {row.is_me && (
          <span className='ml-2 text-xs font-normal'>({t('You')})</span>
        )}
      </p>
      <p
        title={formatNumber(row.total_tokens, locale)}
        className={cn(
          'mt-4 text-xl font-semibold tracking-tight tabular-nums sm:text-3xl',
          gold && 'sm:text-4xl'
        )}
      >
        {formatCompactNumber(row.total_tokens, locale)}
      </p>
      <p className='text-muted-foreground mt-1 text-xs'>Token</p>
      <p className='text-muted-foreground mt-4 text-[10px] leading-5 sm:mt-5 sm:text-xs'>
        {t('{{share}}% of daily tokens', {
          share: formatNumber((row.total_tokens / props.total) * 100, locale),
        })}
      </p>
    </article>
  )
}
