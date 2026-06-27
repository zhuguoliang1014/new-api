import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock,
  History,
  ShieldCheck,
  Trophy,
  XCircle,
} from 'lucide-react'
import { type CSSProperties, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'

import { getWorldCupHistory, getWorldCupStatus, predictWorldCup } from './api'
import type {
  WorldCupChoice,
  WorldCupMatch,
  WorldCupPrediction,
  WorldCupSchedule,
  WorldCupStatusData,
} from './types'

type Translate = (key: string, options?: Record<string, unknown>) => string
type WorldCupPageStyle = CSSProperties & {
  '--world-cup-page-bg': string
}
type WorldCupHistoryEntry = {
  id: string
  match?: WorldCupMatch
  prediction?: WorldCupPrediction
  sortTime: number
}
type WorldCupDevScenario =
  | 'api'
  | 'open'
  | 'live'
  | 'locked'
  | 'pending'
  | 'won'
  | 'lost'
  | 'finished'
  | 'ineligible'
  | 'empty'

const worldCupDevScenarios: {
  value: WorldCupDevScenario
}[] = [
  { value: 'api' },
  { value: 'open' },
  { value: 'live' },
  { value: 'locked' },
  { value: 'pending' },
  { value: 'won' },
  { value: 'lost' },
  { value: 'finished' },
  { value: 'ineligible' },
  { value: 'empty' },
]

const worldCupPageStyle: WorldCupPageStyle = {
  '--world-cup-page-bg': 'url("/world-cup-page-bg.png")',
}

function matchId(match: WorldCupMatch): string {
  if (match.team_id) return match.team_id
  return [
    match.date_time.trim(),
    match.host_team_id.trim(),
    match.guest_team_id.trim(),
  ].join('_')
}

function parseMatchTime(match: WorldCupMatch): number {
  if (!match.date_time) return 0
  const value = Date.parse(`${match.date_time.replace(' ', 'T')}+08:00`)
  return Number.isFinite(value) ? value : 0
}

function formatMatchTime(match: WorldCupMatch): string {
  const timestamp = parseMatchTime(match)
  if (!timestamp) return match.date_time
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function formatPredictionTime(prediction: WorldCupPrediction): string {
  if (!prediction.match_time) return prediction.match_date
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(prediction.match_time * 1000))
}

function isPredictionLocked(match: WorldCupMatch): boolean {
  const timestamp = parseMatchTime(match)
  return timestamp > 0 && Date.now() >= timestamp - 60 * 60 * 1000
}

function isMatchFinished(match: WorldCupMatch): boolean {
  return match.match_status === '3' || match.match_des.includes('完')
}

function choiceLabel(choice: WorldCupChoice, t: Translate): string {
  if (choice === 'host') return t('Home win')
  if (choice === 'guest') return t('Away win')
  return t('Match draw')
}

function predictionLabel(
  choice: WorldCupChoice,
  hostTeamName: string,
  guestTeamName: string,
  t: Translate
): string {
  if (choice === 'host') {
    return t('{{team}} wins', { team: hostTeamName || t('Home team') })
  }
  if (choice === 'guest') {
    return t('{{team}} wins', { team: guestTeamName || t('Away team') })
  }
  return t('Match draw')
}

function choiceSubLabel(
  choice: WorldCupChoice,
  match: WorldCupMatch,
  t: Translate
): string {
  if (choice === 'host') return match.host_team_name || t('Home team')
  if (choice === 'guest') return match.guest_team_name || t('Away team')
  return t('Both teams')
}

function statusLabel(
  prediction: WorldCupPrediction | undefined,
  t: Translate
): string {
  if (!prediction) return t('Not predicted')
  if (prediction.status === 'won') return t('Won')
  if (prediction.status === 'lost') return t('Lost')
  if (prediction.status === 'void') return t('Voided')
  return t('Pending')
}

function upcomingMatches(data: WorldCupStatusData | undefined) {
  return (
    data?.schedule.data
      .flatMap((day) => day.schedule_list)
      .sort((a, b) => parseMatchTime(a) - parseMatchTime(b)) ?? []
  )
}

function completedMatches(schedule: WorldCupSchedule | undefined) {
  return (
    schedule?.data
      .flatMap((day) => day.schedule_list)
      .sort((a, b) => parseMatchTime(b) - parseMatchTime(a)) ?? []
  )
}

function buildHistoryEntries(
  matches: WorldCupMatch[],
  records: WorldCupPrediction[]
): WorldCupHistoryEntry[] {
  const entries = new Map<string, WorldCupHistoryEntry>()
  for (const match of matches) {
    const id = matchId(match)
    entries.set(id, {
      id,
      match,
      sortTime: parseMatchTime(match),
    })
  }
  for (const prediction of records) {
    const existing = entries.get(prediction.match_id)
    if (existing) {
      existing.prediction = prediction
      existing.sortTime = Math.max(existing.sortTime, prediction.match_time)
    } else {
      entries.set(prediction.match_id, {
        id: prediction.match_id,
        prediction,
        sortTime: prediction.match_time,
      })
    }
  }
  return [...entries.values()].sort((a, b) => b.sortTime - a.sortTime)
}

function getMatchStatusText(match: WorldCupMatch, t: Translate): string {
  if (isMatchFinished(match)) return match.match_des || t('Completed')
  if (match.match_status === '1' || match.match_des.includes('进行')) {
    return match.match_des || t('In progress')
  }
  if (isPredictionLocked(match)) return t('Locked before kick-off')
  return match.match_des || t('Open for prediction')
}

function formatDevDateTime(offsetMinutes: number): string {
  const date = new Date(Date.now() + offsetMinutes * 60 * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:00`
}

function buildWorldCupDevStatus(
  scenario: WorldCupDevScenario
): WorldCupStatusData {
  let offsetMinutes = 180
  if (scenario === 'live') {
    offsetMinutes = -35
  } else if (scenario === 'locked') {
    offsetMinutes = 35
  } else if (
    scenario === 'won' ||
    scenario === 'lost' ||
    scenario === 'finished'
  ) {
    offsetMinutes = -180
  }

  const dateTime = formatDevDateTime(offsetMinutes)
  const finished =
    scenario === 'won' || scenario === 'lost' || scenario === 'finished'
  let hostTeamName = '美国'
  let guestTeamName = '墨西哥'
  if (scenario === 'ineligible') {
    hostTeamName = '加拿大'
    guestTeamName = '摩洛哥'
  }

  let hostTeamScore = ''
  let guestTeamScore = ''
  let matchStatus = ''
  let matchDescription = '未开始'
  if (finished) {
    hostTeamScore = '2'
    guestTeamScore = scenario === 'lost' ? '1' : '0'
    matchStatus = '3'
    matchDescription = '已完赛'
  } else if (scenario === 'live') {
    hostTeamScore = '2'
    guestTeamScore = '0'
    matchStatus = '1'
    matchDescription = '进行中'
  }

  const match: WorldCupMatch = {
    team_id: `dev-${scenario}`,
    date: dateTime.slice(0, 10),
    date_time: dateTime,
    host_team_id: 'dev-host',
    guest_team_id: 'dev-guest',
    host_team_name: hostTeamName,
    guest_team_name: guestTeamName,
    host_team_score: hostTeamScore,
    guest_team_score: guestTeamScore,
    match_status: matchStatus,
    match_des: matchDescription,
    match_type: '1',
    match_type_name: '小组赛',
    match_type_des: '小组赛',
    group_name: 'A',
    host_team_logo_url: '',
    guest_team_logo_url: '',
  }
  const predictions: Record<string, WorldCupPrediction> = {}
  const id = matchId(match)

  if (scenario === 'pending' || scenario === 'won' || scenario === 'lost') {
    let predictionStatus: WorldCupPrediction['status'] = 'pending'
    if (scenario === 'won') {
      predictionStatus = 'won'
    } else if (scenario === 'lost') {
      predictionStatus = 'lost'
    }

    predictions[id] = {
      id: 9001,
      match_id: id,
      match_date: match.date,
      match_time: Math.floor(parseMatchTime(match) / 1000),
      match_type: match.match_type_des,
      group_name: match.group_name,
      host_team_name: match.host_team_name,
      guest_team_name: match.guest_team_name,
      choice: scenario === 'lost' ? 'guest' : 'host',
      status: predictionStatus,
      reward_quota: scenario === 'won' ? 3 : 0,
      streak_bonus_quota: 0,
      settled_at:
        scenario === 'won' || scenario === 'lost'
          ? Math.floor(Date.now() / 1000)
          : 0,
      created_at: Math.floor(Date.now() / 1000) - 60 * 30,
    }
  }

  return {
    eligible: scenario !== 'ineligible',
    predictions,
    schedule: {
      reason: 'dev',
      data:
        scenario === 'empty'
          ? []
          : [
              {
                schedule_date: match.date,
                schedule_date_format: match.date,
                schedule_week: '',
                schedule_current: '1',
                schedule_list: [match],
              },
            ],
    },
  }
}

export function WorldCup() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null)
  const [devScenario, setDevScenario] = useState<WorldCupDevScenario>('api')

  const statusQuery = useQuery({
    queryKey: ['world-cup-status'],
    queryFn: () => getWorldCupStatus(),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const status = statusQuery.data?.data
  const usingDevScenario = import.meta.env.DEV && devScenario !== 'api'
  const displayStatus = useMemo(
    () => (usingDevScenario ? buildWorldCupDevStatus(devScenario) : status),
    [devScenario, status, usingDevScenario]
  )
  const matches = useMemo(() => upcomingMatches(displayStatus), [displayStatus])
  const eligible = displayStatus?.eligible ?? false
  const showingScheduleLoading = statusQuery.isLoading && !usingDevScenario

  const mutation = useMutation({
    mutationFn: predictWorldCup,
    onSuccess: async (res) => {
      if (!res.success) return
      toast.success(t('Prediction saved'))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['world-cup-status'] }),
        queryClient.invalidateQueries({ queryKey: ['world-cup-history'] }),
      ])
    },
    onSettled: () => setActiveMatchId(null),
  })

  const submitPrediction = (match: WorldCupMatch, choice: WorldCupChoice) => {
    const id = matchId(match)
    setActiveMatchId(id)
    if (usingDevScenario) {
      toast.info('开发测试场景仅用于预览，不会提交竞猜')
      setActiveMatchId(null)
      return
    }
    mutation.mutate({
      match_id: id,
      date: match.date,
      choice,
    })
  }

  return (
    <SectionPageLayout hideHeader>
      <SectionPageLayout.Content>
        <div
          className='world-cup-page-shell relative isolate -mx-3 -mt-1 min-h-full px-3 py-4 sm:-mx-4 sm:px-4 sm:py-5'
          style={worldCupPageStyle}
        >
          <div className='relative z-10 mx-auto flex w-full max-w-7xl flex-col gap-6'>
            <section className='relative aspect-[16/9] min-h-[190px] overflow-hidden rounded-lg border bg-emerald-950 text-white shadow-sm sm:aspect-[5/2] sm:min-h-[240px] lg:aspect-[3/1] lg:min-h-0'>
              <img
                src='/world-cup-hero.png'
                alt=''
                className='absolute inset-0 size-full object-cover'
                aria-hidden='true'
              />
              <div className='absolute inset-0 bg-[linear-gradient(90deg,rgba(3,38,25,.42),rgba(3,38,25,.18)_44%,rgba(3,38,25,.04))]' />
              <div className='absolute inset-x-0 bottom-0 h-32 bg-[linear-gradient(0deg,rgba(3,38,25,.70),rgba(3,38,25,0))]' />
              <div className='relative flex h-full items-end p-4 pb-4 sm:p-8 sm:pb-6 lg:p-10 lg:pb-8'>
                <div className='max-w-3xl translate-y-2 sm:translate-y-3'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <Badge className='h-9 rounded-full border-white/25 bg-white/15 px-3 text-xs font-semibold text-white shadow-sm backdrop-blur-md'>
                      {t('All matches')}
                    </Badge>
                    <EligibilityPanel eligible={eligible} />
                    <RulesDialog />
                  </div>
                  <p className='mt-3 max-w-md text-sm leading-6 text-white/85 sm:text-base sm:leading-7'>
                    {t(
                      'Predict any World Cup match before lock time. Correct picks are settled automatically after official results.'
                    )}
                  </p>
                </div>
              </div>
            </section>

            {import.meta.env.DEV ? (
              <WorldCupDevPanel
                scenario={devScenario}
                onScenarioChange={setDevScenario}
              />
            ) : null}

            {showingScheduleLoading ? <ScheduleSkeleton /> : null}

            {!showingScheduleLoading && matches.length === 0 ? (
              <Empty className='rounded-lg border border-dashed py-16'>
                <EmptyHeader>
                  <EmptyMedia variant='icon'>
                    <CalendarDays aria-hidden='true' />
                  </EmptyMedia>
                  <EmptyTitle>{t('No matches found')}</EmptyTitle>
                  <EmptyDescription>
                    {t(
                      'Current and upcoming matches will appear here when available'
                    )}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}

            {!showingScheduleLoading && matches.length > 0 ? (
              <section className='flex flex-col gap-3'>
                <div className='flex items-end justify-between gap-3 border-b border-emerald-950/10 pb-3'>
                  <div>
                    <div className='text-muted-foreground text-xs font-medium uppercase'>
                      {t('Current & upcoming matches')}
                    </div>
                    <h2 className='text-xl font-semibold text-emerald-950'>
                      {t('Sorted by kick-off time')}
                    </h2>
                  </div>
                  <Badge variant='outline'>
                    {t('{{count}} matches', { count: matches.length })}
                  </Badge>
                </div>
                <div className='no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-smooth pr-[18vw] pb-2 sm:pr-[22vw] lg:pr-[28vw]'>
                  {matches.map((match) => (
                    <div
                      key={matchId(match)}
                      className='w-[88vw] max-w-[520px] shrink-0 snap-start sm:w-[460px] lg:w-[520px]'
                    >
                      <MatchCard
                        match={match}
                        prediction={displayStatus?.predictions[matchId(match)]}
                        eligible={eligible}
                        active={activeMatchId === matchId(match)}
                        onPredict={submitPrediction}
                      />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <div className='bg-muted/20 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3'>
              <div className='min-w-0'>
                <div className='flex items-center gap-2 text-sm font-semibold'>
                  <History
                    className='text-muted-foreground size-4'
                    aria-hidden='true'
                  />
                  {t('World Cup History')}
                </div>
                <p className='text-muted-foreground mt-1 text-xs'>
                  {t(
                    'View completed matches and your prediction records on a separate page'
                  )}
                </p>
              </div>
              <Button
                variant='outline'
                render={<Link to='/world-cup/history' />}
              >
                <History data-icon='inline-start' aria-hidden='true' />
                {t('View History')}
              </Button>
            </div>
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function WorldCupDevPanel(props: {
  scenario: WorldCupDevScenario
  onScenarioChange: (scenario: WorldCupDevScenario) => void
}) {
  const scenarioLabels: Record<WorldCupDevScenario, string> = {
    api: '真实接口',
    open: '可竞猜',
    live: '比赛中',
    locked: '临近开赛',
    pending: '已竞猜待开奖',
    won: '猜中了',
    lost: '没猜中',
    finished: '已结束',
    ineligible: '无资格',
    empty: '无赛事',
  }

  return (
    <section className='rounded-lg border border-amber-500/35 bg-amber-50/85 px-4 py-3 shadow-sm backdrop-blur-sm dark:bg-amber-950/25'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0'>
          <div className='flex items-center gap-2 text-sm font-semibold text-amber-950 dark:text-amber-100'>
            <Badge
              variant='outline'
              className='border-amber-500/60 bg-amber-100/70 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100'
            >
              DEV
            </Badge>
            世界杯开发测试面板
          </div>
          <p className='mt-1 text-xs text-amber-900/70 dark:text-amber-100/70'>
            本地模拟各种页面状态，不调用赛事接口，也不会提交竞猜。
          </p>
        </div>
        <div className='flex max-w-full flex-wrap gap-2'>
          {worldCupDevScenarios.map((scenario) => (
            <Button
              key={scenario.value}
              size='sm'
              variant={
                props.scenario === scenario.value ? 'default' : 'outline'
              }
              className={
                props.scenario === scenario.value
                  ? 'border-amber-700 bg-amber-700 text-white hover:bg-amber-800'
                  : 'dark:bg-background/60 border-amber-500/45 bg-white/80 text-amber-950 hover:bg-amber-100 dark:text-amber-100'
              }
              onClick={() => props.onScenarioChange(scenario.value)}
            >
              {scenarioLabels[scenario.value]}
            </Button>
          ))}
        </div>
      </div>
    </section>
  )
}

export function WorldCupHistoryPage() {
  const { t } = useTranslation()
  const historyQuery = useQuery({
    queryKey: ['world-cup-history', 'page'],
    queryFn: () => getWorldCupHistory(1, 100),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const completed = useMemo(
    () => completedMatches(historyQuery.data?.data?.completed_schedule),
    [historyQuery.data?.data]
  )
  const entries = useMemo(
    () =>
      buildHistoryEntries(completed, historyQuery.data?.data?.records ?? []),
    [completed, historyQuery.data?.data?.records]
  )

  return (
    <SectionPageLayout>
      <SectionPageLayout.Content>
        <div className='mx-auto flex w-full max-w-7xl flex-col gap-6'>
          <div className='flex justify-end'>
            <Button variant='outline' render={<Link to='/world-cup' />}>
              <ArrowLeft data-icon='inline-start' aria-hidden='true' />
              {t('Back to World Cup')}
            </Button>
          </div>

          {historyQuery.isLoading ? (
            <HistorySkeleton />
          ) : (
            <WorldCupHistoryCards entries={entries} />
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

function EligibilityPanel(props: { eligible: boolean }) {
  const { t } = useTranslation()

  return (
    <Link
      to='/my-wallet'
      search={{ tab: 'subscription' }}
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-full border border-white/25 bg-white/15 px-3 text-xs font-semibold text-white shadow-sm backdrop-blur-md transition-colors outline-none hover:bg-white/25 focus-visible:ring-2 focus-visible:ring-white/70',
        props.eligible
          ? 'hover:border-emerald-200/55'
          : 'hover:border-amber-200/60'
      )}
      aria-label={t('Subscribe to the World Cup package to join predictions')}
    >
      {props.eligible ? (
        <ShieldCheck className='size-3.5' aria-hidden='true' />
      ) : (
        <XCircle className='size-3.5' aria-hidden='true' />
      )}
      {props.eligible
        ? t('World Cup package active')
        : t('World Cup package required')}
    </Link>
  )
}

function RulesDialog() {
  const { t } = useTranslation()
  const rules = [
    t('Only users with an active World Cup package can join.'),
    t('All World Cup matches are open for prediction.'),
    t('Each account can submit one prediction per match.'),
    t('Predictions close 1 hour before kick-off.'),
    t(
      'Results and rewards are handled automatically by the server; refresh the page to see the latest status.'
    ),
    t(
      'Correct picks receive quota based on package total quota divided by package days and then divided by 10.'
    ),
    t('Consecutive correct predictions can trigger milestone bonus quota.'),
  ]

  return (
    <Dialog
      title={t('World Cup Prediction Rules')}
      description={t('Simple rules for this event')}
      trigger={
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='h-9 rounded-full border-white/25 bg-white/15 px-3 text-xs font-semibold text-white shadow-sm backdrop-blur-md hover:bg-white/25 hover:text-white focus-visible:ring-white/70'
        >
          <BookOpen data-icon='inline-start' aria-hidden='true' />
          {t('View Rules')}
        </Button>
      }
      contentClassName='sm:max-w-lg'
      showCloseButton
    >
      <div className='flex flex-col gap-3 px-1'>
        {rules.map((rule, index) => (
          <div
            key={rule}
            className='bg-muted/30 flex gap-3 rounded-lg border p-3'
          >
            <Badge variant='secondary'>{index + 1}</Badge>
            <p className='text-sm leading-6'>{rule}</p>
          </div>
        ))}
      </div>
    </Dialog>
  )
}

function ScheduleSkeleton() {
  const skeletonKeys = ['first', 'second', 'third', 'fourth']

  return (
    <div className='no-scrollbar flex gap-3 overflow-x-auto pr-[18vw] pb-2 sm:pr-[22vw] lg:pr-[28vw]'>
      {skeletonKeys.map((key) => (
        <Card
          key={key}
          className='w-[82vw] max-w-[520px] shrink-0 sm:w-[460px] lg:w-[520px]'
        >
          <CardHeader>
            <Skeleton className='h-5 w-40' />
            <Skeleton className='h-4 w-28' />
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <Skeleton className='h-16 w-full' />
            <Skeleton className='h-10 w-full' />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function MatchCard(props: {
  match: WorldCupMatch
  prediction?: WorldCupPrediction
  eligible: boolean
  active: boolean
  onPredict: (match: WorldCupMatch, choice: WorldCupChoice) => void
}) {
  const { t } = useTranslation()
  const finished = isMatchFinished(props.match)
  const locked = isPredictionLocked(props.match)
  const canPredict = props.eligible && !locked && !finished && !props.prediction
  const disabled = !canPredict || props.active
  const score = `${props.match.host_team_score || '0'} : ${
    props.match.guest_team_score || '0'
  }`
  let PredictionStatusIcon = Clock
  if (props.prediction?.status === 'won') {
    PredictionStatusIcon = CheckCircle2
  } else if (
    props.prediction?.status === 'lost' ||
    props.prediction?.status === 'void'
  ) {
    PredictionStatusIcon = XCircle
  }

  return (
    <Card className='overflow-hidden border-emerald-950/10 shadow-sm'>
      <div className='h-1 bg-[linear-gradient(90deg,#0f8a4b,#f2c14e,#c7332d)]' />
      <CardHeader className='gap-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            {props.match.group_name ? (
              <Badge variant='outline'>
                {t('Group {{group}}', { group: props.match.group_name })}
              </Badge>
            ) : null}
            <Badge variant='secondary'>{props.match.match_type_des}</Badge>
          </div>
          <Badge variant={finished ? 'secondary' : 'outline'}>
            {getMatchStatusText(props.match, t)}
          </Badge>
        </div>
        <div className='grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2'>
          <TeamBlock
            name={props.match.host_team_name}
            logo={props.match.host_team_logo_url}
          />
          <div className='bg-muted/35 flex h-12 min-w-[78px] items-center justify-center rounded-lg border px-2 text-center sm:h-14 sm:min-w-20 sm:px-3'>
            <div>
              <div className='text-muted-foreground text-[11px] font-medium uppercase'>
                {finished ? t('Result') : t('Kick-off')}
              </div>
              <div className='text-xs font-semibold tabular-nums sm:text-sm'>
                {finished ? score : formatMatchTime(props.match)}
              </div>
            </div>
          </div>
          <TeamBlock
            name={props.match.guest_team_name}
            logo={props.match.guest_team_logo_url}
            align='right'
          />
        </div>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='grid grid-cols-3 gap-2'>
          {(['host', 'draw', 'guest'] as WorldCupChoice[]).map((choice) => {
            const selectedChoice = props.prediction?.choice === choice
            return (
              <Button
                key={choice}
                className={cn(
                  'h-14 min-w-0 flex-col gap-0.5 px-2 transition-colors disabled:pointer-events-none',
                  selectedChoice &&
                    'border-emerald-600 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 disabled:border-emerald-600 disabled:bg-emerald-600 disabled:text-white disabled:opacity-100 dark:border-emerald-500 dark:bg-emerald-600',
                  props.prediction &&
                    !selectedChoice &&
                    'border-emerald-950/10 bg-white/70 text-muted-foreground disabled:opacity-70 dark:bg-background/50'
                )}
                variant='outline'
                disabled={disabled}
                onClick={() => props.onPredict(props.match, choice)}
              >
                {props.active ? (
                  t('Saving...')
                ) : (
                  <>
                    <span className='text-sm leading-5 font-semibold'>
                      {choiceLabel(choice, t)}
                    </span>
                    <span className='max-w-full truncate text-[11px] leading-4 font-normal opacity-75'>
                      {choiceSubLabel(choice, props.match, t)}
                    </span>
                  </>
                )}
              </Button>
            )
          })}
        </div>

        <div
          className={cn(
            'flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,.7)]',
            props.prediction
              ? 'border-emerald-950/10 bg-white/80 dark:bg-background/60'
              : 'border-dashed border-emerald-950/15 bg-white/55 text-muted-foreground dark:bg-background/40'
          )}
        >
          <div className='min-w-0'>
            <div className='text-muted-foreground text-xs font-medium'>
              {t('Your prediction')}
            </div>
            <div className='text-foreground truncate font-semibold'>
              {props.prediction
                ? predictionLabel(
                    props.prediction.choice,
                    props.match.host_team_name,
                    props.match.guest_team_name,
                    t
                  )
                : t('Not predicted yet')}
            </div>
          </div>
          <span
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
              props.prediction?.status === 'won' &&
                'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
              props.prediction?.status === 'lost' &&
                'border-destructive/30 bg-destructive/10 text-destructive',
              props.prediction?.status === 'void' &&
                'border-muted-foreground/25 bg-muted/30 text-muted-foreground',
              (!props.prediction || props.prediction.status === 'pending') &&
                'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            )}
          >
            <PredictionStatusIcon className='size-3.5' aria-hidden='true' />
            {statusLabel(props.prediction, t)}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

function TeamBlock(props: {
  name: string
  logo: string
  align?: 'left' | 'right'
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 sm:gap-3',
        props.align === 'right' && 'flex-row-reverse text-right'
      )}
    >
      <div className='bg-background flex size-9 shrink-0 items-center justify-center rounded-lg border sm:size-12'>
        {props.logo ? (
          <img
            src={props.logo}
            alt=''
            className='size-6 object-contain sm:size-9'
            loading='lazy'
          />
        ) : (
          <Trophy className='text-muted-foreground size-5' aria-hidden='true' />
        )}
      </div>
      <div className='min-w-0'>
        <div className='truncate text-[13px] leading-5 font-semibold sm:text-base'>
          {props.name}
        </div>
      </div>
    </div>
  )
}

function HistorySkeleton() {
  return (
    <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
      {['first', 'second', 'third'].map((key) => (
        <Card key={key} className='overflow-hidden'>
          <Skeleton className='h-1 w-full' />
          <CardHeader className='gap-3'>
            <div className='flex items-center justify-between gap-2'>
              <Skeleton className='h-5 w-24' />
              <Skeleton className='h-5 w-16' />
            </div>
            <Skeleton className='h-16 w-full' />
          </CardHeader>
          <CardContent>
            <Skeleton className='h-14 w-full' />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

function WorldCupHistoryCards(props: { entries: WorldCupHistoryEntry[] }) {
  const { t } = useTranslation()
  if (props.entries.length === 0) {
    return (
      <Empty className='rounded-lg border border-dashed py-10'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <Trophy aria-hidden='true' />
          </EmptyMedia>
          <EmptyTitle>{t('No completed matches yet')}</EmptyTitle>
          <EmptyDescription>
            {t(
              'Completed matches and prediction results will appear here after settlement'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
      {props.entries.map((entry) => (
        <WorldCupHistoryCard key={entry.id} entry={entry} />
      ))}
    </div>
  )
}

function WorldCupHistoryCard(props: { entry: WorldCupHistoryEntry }) {
  const { t } = useTranslation()
  const { match, prediction } = props.entry
  const hostName = match?.host_team_name || prediction?.host_team_name || ''
  const guestName = match?.guest_team_name || prediction?.guest_team_name || ''
  const hasFinalScore = Boolean(
    match &&
      (match.host_team_score || match.guest_team_score || isMatchFinished(match))
  )
  const centerValue = hasFinalScore
    ? `${match?.host_team_score || '0'} : ${match?.guest_team_score || '0'}`
    : prediction
      ? formatPredictionTime(prediction)
      : '- : -'
  const rewardQuota =
    prediction?.status === 'won'
      ? Number(prediction.reward_quota || 0) +
        Number(prediction.streak_bonus_quota || 0)
      : 0
  let PredictionStatusIcon = Clock
  if (prediction?.status === 'won') {
    PredictionStatusIcon = CheckCircle2
  } else if (prediction?.status === 'lost' || prediction?.status === 'void') {
    PredictionStatusIcon = XCircle
  }

  return (
    <Card className='overflow-hidden border-emerald-950/10 shadow-sm'>
      <div className='h-1 bg-[linear-gradient(90deg,#0f8a4b,#f2c14e,#c7332d)]' />
      <CardHeader className='gap-3'>
        <div className='flex flex-wrap items-center justify-between gap-2'>
          <div className='flex flex-wrap items-center gap-2'>
            {(match?.group_name || prediction?.group_name) ? (
              <Badge variant='outline'>
                {t('Group {{group}}', {
                  group: match?.group_name || prediction?.group_name,
                })}
              </Badge>
            ) : null}
            {match?.match_type_des || prediction?.match_type ? (
              <Badge variant='secondary'>
                {match?.match_type_des || prediction?.match_type}
              </Badge>
            ) : null}
          </div>
          <Badge variant='secondary'>
            {match?.match_des ||
              (prediction ? statusLabel(prediction, t) : t('Completed'))}
          </Badge>
        </div>

        <div className='grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2'>
          <TeamBlock name={hostName} logo={match?.host_team_logo_url || ''} />
          <div className='bg-muted/35 flex h-12 min-w-[78px] items-center justify-center rounded-lg border px-2 text-center sm:h-14 sm:min-w-20 sm:px-3'>
            <div>
              <div className='text-muted-foreground text-[11px] font-medium uppercase'>
                {hasFinalScore ? t('Final score') : t('Kick-off')}
              </div>
              <div className='text-xs font-semibold tabular-nums sm:text-sm'>
                {centerValue}
              </div>
            </div>
          </div>
          <TeamBlock
            name={guestName}
            logo={match?.guest_team_logo_url || ''}
            align='right'
          />
        </div>
      </CardHeader>

      <CardContent className='flex flex-col gap-3'>
        {prediction ? (
          <>
            <div className='grid grid-cols-3 gap-2'>
              {(['host', 'draw', 'guest'] as WorldCupChoice[]).map((choice) => {
                const selectedChoice = prediction.choice === choice
                return (
                  <div
                    key={choice}
                    className={cn(
                      'flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 text-center text-sm',
                      selectedChoice
                        ? 'border-emerald-600 bg-emerald-600 text-white shadow-sm dark:border-emerald-500 dark:bg-emerald-600'
                        : 'border-emerald-950/10 bg-white/70 text-muted-foreground opacity-70 dark:bg-background/50'
                    )}
                  >
                    <span className='text-sm leading-5 font-semibold'>
                      {choiceLabel(choice, t)}
                    </span>
                    <span className='max-w-full truncate text-[11px] leading-4 font-normal opacity-75'>
                      {choiceSubLabel(
                        choice,
                        {
                          host_team_name: hostName,
                          guest_team_name: guestName,
                        } as WorldCupMatch,
                        t
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            <div
              className={cn(
                'flex min-h-12 items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,.7)]',
                prediction.status === 'won'
                  ? 'border-emerald-500/30 bg-emerald-500/10'
                  : 'border-emerald-950/10 bg-white/80 dark:bg-background/60'
              )}
            >
              <div className='min-w-0'>
                <div className='text-muted-foreground text-xs font-medium'>
                  {t('Your prediction')}
                </div>
                <div className='text-foreground truncate font-semibold'>
                  {predictionLabel(prediction.choice, hostName, guestName, t)}
                </div>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {rewardQuota > 0 ? (
                  <Badge variant='outline'>
                    {t('Reward {{amount}}', {
                      amount: formatQuota(rewardQuota),
                    })}
                  </Badge>
                ) : null}
                <span
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium',
                    prediction.status === 'won' &&
                      'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                    prediction.status === 'lost' &&
                      'border-destructive/30 bg-destructive/10 text-destructive',
                    prediction.status === 'void' &&
                      'border-muted-foreground/25 bg-muted/30 text-muted-foreground',
                    prediction.status === 'pending' &&
                      'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  )}
                >
                  <PredictionStatusIcon
                    className='size-3.5'
                    aria-hidden='true'
                  />
                  {statusLabel(prediction, t)}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className='flex min-h-12 items-center justify-between gap-3 rounded-lg border border-dashed border-emerald-950/15 bg-white/55 px-3 py-2 text-sm text-muted-foreground dark:bg-background/40'>
            <div>
              <div className='text-xs font-medium'>{t('Your prediction')}</div>
              <div className='font-semibold'>{t('Not predicted')}</div>
            </div>
            <Badge variant='outline'>{t('Completed')}</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
