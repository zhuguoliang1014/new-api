import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  X,
} from 'lucide-react'
import { formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { copyToClipboard } from '@/lib/copy-to-clipboard'
import { getLuckyBagStatus, enterLuckyBag, getLuckyBagHistory, markLuckyBagViewed } from './api'
import { useNextDrawCountdown } from './hooks'
import type { EligibilityInfo, LuckyBagActivity, LuckyBagResultCard, LuckyBagStatusResponse } from './types'

type DrawAnimationPhase = 'idle' | 'shaking' | 'opening'

const HISTORY_PAGE_SIZE = 10

function pad(n: number) {
  return n.toString().padStart(2, '0')
}

function splitWinnerDisplayName(name: string) {
  const trimmed = name.trim()
  const match = trimmed.match(/^(.*?)\s*[（(]\s*UID\s*(\d+)\s*[）)]$/i)

  if (!match) {
    return { name: trimmed, uid: '' }
  }

  return { name: match[1].trim(), uid: match[2] }
}

function buildDebugActivity(overrides: Partial<LuckyBagActivity> = {}): LuckyBagActivity {
  const now = new Date()
  const timestamp = Math.floor(now.getTime() / 1000)

  return {
    id: -Math.floor(Math.random() * 1_000_000) - 1,
    draw_date: now.toISOString().slice(0, 10),
    slot_hour: 12,
    slot_minute: 0,
    min_quota: 0,
    max_quota: 0,
    status: 'pending',
    winner_user_id: 0,
    winner_name: '',
    winner_quota: 0,
    winner_code: '',
    winner2_user_id: 0,
    winner2_name: '',
    winner2_quota: 0,
    winner2_code: '',
    winner3_user_id: 0,
    winner3_name: '',
    winner3_quota: 0,
    winner3_code: '',
    drawn_at: 0,
    created_at: timestamp,
    ...overrides,
  }
}

// =============================================================================
// Design language — Apple.
//
// Silver-white canvas, softly layered product-render lighting, white translucent
// cards, hairline dividers, one accent (#0071e3). Typography still carries the
// page, but material detail gives it the "hardware in a keynote" tactility.
// =============================================================================

const INK = '#1d1d1f' // primary text
const GRAY = '#6e6e73' // secondary text
const FAINT = '#86868b' // tertiary text
const HAIRLINE = '#e8e8ed' // dividers
const BLUE = '#0071e3' // the single accent
const BLUE_HOVER = '#0077ed'

const CARD =
  'relative overflow-hidden rounded-[28px] border border-white/80 bg-white/75 shadow-[0_18px_55px_rgba(29,29,31,0.08)] backdrop-blur-xl'

// ─── CountdownUnit — one oversized ultralight numeral group ─────────────────
function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div
      className='relative flex min-w-[5.8rem] flex-col items-center gap-3 overflow-hidden rounded-[28px] px-3 py-5 sm:min-w-[7rem] sm:px-5'
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(247,248,251,0.78) 100%)',
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.95), inset 0 -1px 0 rgba(0,0,0,0.04), 0 22px 50px rgba(29,29,31,0.08)',
      }}
    >
      <span
        aria-hidden
        className='pointer-events-none absolute inset-x-4 top-0 h-px'
        style={{ background: 'linear-gradient(90deg, transparent, #fff, transparent)' }}
      />
      <span
        aria-hidden
        className='pointer-events-none absolute -right-10 -top-12 size-28 rounded-full blur-2xl'
        style={{ background: 'rgba(255,255,255,0.75)' }}
      />
      <span
        className='relative text-[clamp(3.7rem,9.6vw,6.8rem)] font-extralight leading-[0.92] tracking-[-0.04em] tabular-nums'
        style={{ color: INK }}
      >
        {pad(value)}
      </span>
      <span className='relative text-xs font-medium' style={{ color: FAINT }}>
        {label}
      </span>
    </div>
  )
}

function CountdownColon() {
  return (
    <span
      aria-hidden
      className='pb-8 text-[clamp(2.1rem,5vw,3.8rem)] font-extralight leading-[0.92]'
      style={{ color: '#d2d2d7' }}
    >
      :
    </span>
  )
}

// ─── HeroCta — one pill button, Apple blue, quiet state branches ────────────
function HeroCta({
  entered,
  entering,
  todayFinished,
  isNextDrawn,
  drawBusy,
  eligibility,
  onEnter,
}: {
  entered: boolean
  entering: boolean
  todayFinished: boolean
  isNextDrawn: boolean
  drawBusy: boolean
  eligibility: EligibilityInfo | null
  onEnter: () => void
}) {
  const { t } = useTranslation()

  const mutedShell =
    'inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white/80 px-7 text-[15px] font-normal text-[#86868b] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05),0_10px_28px_rgba(29,29,31,0.06)] backdrop-blur'

  if (drawBusy) {
    return (
      <div className={mutedShell}>
        <Loader2 className='size-4 animate-spin' />
        {t('Drawing...')}
      </div>
    )
  }

  if (todayFinished) {
    return (
      <div className={mutedShell}>
        <Clock className='size-4' />
        {t("Today's draws finished")}
      </div>
    )
  }

  // 无资格：昨日消费不足
  if (eligibility && eligibility.eligible_slots === 0) {
    return (
      <div className={mutedShell}>
        <Clock className='size-4' />
        {t('Insufficient spend yesterday')}
      </div>
    )
  }

  // 每日上限已达
  if (eligibility && eligibility.daily_limit_reached) {
    return (
      <div className={mutedShell}>
        <Check className='size-4' />
        {t("Today's limit reached")}
      </div>
    )
  }

  // 今日次数用完
  if (eligibility && eligibility.remaining_slots === 0 && eligibility.eligible_slots > 0) {
    return (
      <div className={mutedShell}>
        <Clock className='size-4' />
        {t("Today's chances used up")}
      </div>
    )
  }

  if (entering) {
    return (
      <div
        className='inline-flex h-12 items-center justify-center gap-2 rounded-full px-7 text-[15px] font-normal text-white'
        style={{
          background: `linear-gradient(180deg, ${BLUE_HOVER} 0%, ${BLUE} 100%)`,
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.35), 0 14px 34px rgba(0,113,227,0.22)',
        }}
      >
        <Loader2 className='size-4 animate-spin' />
        {t('Entering...')}
      </div>
    )
  }

  if (entered) {
    return (
      <div
        className='inline-flex h-12 items-center justify-center gap-2 rounded-full px-7 text-[15px] font-medium'
        style={{
          background: 'rgba(255,255,255,0.82)',
          boxShadow: 'inset 0 0 0 1px rgba(0,113,227,0.15), 0 12px 28px rgba(0,0,0,0.05)',
          color: BLUE,
        }}
      >
        <Check className='size-4' strokeWidth={2.5} />
        {t('Entered')}
      </div>
    )
  }

  if (isNextDrawn) {
    return <div className={mutedShell}>{t('Already drawn')}</div>
  }

  return (
    <button
      type='button'
      onClick={onEnter}
      className='inline-flex h-12 cursor-pointer items-center justify-center rounded-full px-8 text-[15px] font-normal text-white transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0'
      style={{
        background: `linear-gradient(180deg, ${BLUE_HOVER} 0%, ${BLUE} 100%)`,
        boxShadow:
          'inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -1px 0 rgba(0,40,90,0.18), 0 18px 38px rgba(0,113,227,0.24)',
      }}
    >
      {t('Enter Lucky Bag Draw')}
    </button>
  )
}

// ─── EligibilityPanel — 参与资格面板（对应截图右侧三条资格条目）────────────
const SPEND_TIERS = [
  { minUsd: 99.9, slots: 5 },
  { minUsd: 59.9, slots: 3 },
  { minUsd: 29.9, slots: 2 },
  { minUsd: 9.9, slots: 1 },
]

function EligibilityPanel({ eligibility }: { eligibility: EligibilityInfo | null }) {
  const { t } = useTranslation()

  const spendUsd = eligibility ? eligibility.yesterday_spend_quota / 500000 : 0
  const eligibleSlots = eligibility?.eligible_slots ?? 0
  const usedSlots = eligibility?.used_slots ?? 0
  const remainingSlots = eligibility?.remaining_slots ?? 0
  const dailyLimitReached = eligibility?.daily_limit_reached ?? false
  const todayWonUsd = eligibility ? eligibility.today_won_quota / 500000 : 0

  const spendMet = eligibleSlots > 0
  // 距离下一档还差多少
  const nextTier = SPEND_TIERS.slice().reverse().find((tier) => spendUsd < tier.minUsd && tier.minUsd > 9.9)
  const gapToNext = nextTier ? nextTier.minUsd - spendUsd : 0

  // 当前档位
  const currentTier = SPEND_TIERS.find((tier) => spendUsd >= tier.minUsd)

  type RowStatus = 'met' | 'limited' | 'unmet'
  function EligibilityRow({
    status,
    main,
    sub,
    badge,
  }: {
    status: RowStatus
    main: React.ReactNode
    sub: React.ReactNode
    badge: React.ReactNode
  }) {
    return (
      <div
        className='flex min-w-0 items-start justify-between gap-3 rounded-2xl border p-3.5'
        style={
          status === 'met'
            ? { borderColor: 'rgba(52,199,89,0.25)', background: 'rgba(52,199,89,0.05)' }
            : status === 'limited'
              ? { borderColor: 'rgba(255,149,0,0.25)', background: 'rgba(255,149,0,0.05)' }
              : { borderColor: HAIRLINE, background: 'rgba(255,255,255,0.5)' }
        }
      >
        <div className='flex min-w-0 flex-1 items-start gap-2.5'>
          <span
            className='mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full'
            style={
              status === 'met'
                ? { background: '#34c759' }
                : status === 'limited'
                  ? { background: '#ff9500' }
                  : { background: '#aeaeb2' }
            }
          >
            <Check className='size-2.5 text-white' strokeWidth={3} />
          </span>
          <div className='min-w-0'>
            <p className='text-[14px] font-medium leading-snug' style={{ color: INK }}>
              {main}
            </p>
            <p className='mt-0.5 text-[12px] leading-snug' style={{ color: FAINT }}>
              {sub}
            </p>
          </div>
        </div>
        <span
          className='shrink-0 text-[13px] font-medium tabular-nums'
          style={{
            color:
              status === 'met' ? '#34c759' : status === 'limited' ? '#ff9500' : '#aeaeb2',
          }}
        >
          {badge}
        </span>
      </div>
    )
  }

  return (
    <section className={cn(CARD, 'p-5 sm:p-6')}>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-20'
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.7), transparent)' }}
      />
      <div className='relative mb-4 flex items-baseline justify-between gap-3'>
        <h2 className='text-[16px] font-semibold' style={{ color: INK }}>
          {t('Eligibility')}
        </h2>
        <span
          className='rounded-full px-2 py-0.5 text-[12px] font-medium'
          style={
            spendMet
              ? { background: 'rgba(52,199,89,0.1)', color: '#34c759' }
              : { background: 'rgba(142,142,147,0.1)', color: '#8e8e93' }
          }
        >
          {spendMet ? t('Eligible') : t('Not eligible')}
        </span>
      </div>

      <div className='relative space-y-2.5'>
        {/* 1. 消费门槛 */}
        <EligibilityRow
          status={spendMet ? 'met' : 'unmet'}
          main={t('Yesterday spend ${{amount}}', { amount: spendUsd.toFixed(2) })}
          sub={t('API billing only, excludes gifted credits and manual top-ups')}
          badge={
            spendMet
              ? t('Qualified')
              : gapToNext > 0
                ? t('-${{gap}}', { gap: gapToNext.toFixed(2) })
                : t('Not qualified')
          }
        />

        {/* 2. 今日机会 */}
        <EligibilityRow
          status={spendMet && remainingSlots > 0 ? 'met' : 'unmet'}
          main={
            spendMet
              ? t('Today {{used}}/{{total}} chances used, {{remaining}} left', {
                  used: usedSlots,
                  total: eligibleSlots,
                  remaining: remainingSlots,
                })
              : t('No chances today')
          }
          sub={t('More spend = more chances, up to 5 per day')}
          badge={spendMet ? `${remainingSlots} ${t('left')}` : `0 ${t('left')}`}
        />

        {/* 3. 每日上限 */}
        <EligibilityRow
          status={dailyLimitReached ? 'limited' : spendMet ? 'met' : 'unmet'}
          main={t('Daily cap $10 per person')}
          sub={t('Prevents excessive claiming, controls activity cost')}
          badge={
            dailyLimitReached
              ? t('Capped')
              : spendMet
                ? `$${todayWonUsd.toFixed(2)} / $10`
                : '-'
          }
        />
      </div>

      {/* 档位进度卡片 */}
      <div
        className='relative mt-4 grid grid-cols-4 gap-1.5 rounded-2xl border p-3'
        style={{ borderColor: HAIRLINE, background: 'rgba(255,255,255,0.5)' }}
      >
        {SPEND_TIERS.slice().reverse().map((tier) => {
          const isCurrent = currentTier?.slots === tier.slots
          const isPast = spendUsd >= tier.minUsd
          return (
            <div
              key={tier.minUsd}
              className='flex flex-col items-center gap-1 rounded-xl py-2'
              style={
                isCurrent
                  ? { background: BLUE, boxShadow: '0 6px 18px rgba(0,113,227,0.22)' }
                  : isPast
                    ? { background: 'rgba(52,199,89,0.08)' }
                    : { background: 'transparent' }
              }
            >
              <span
                className='text-[13px] font-semibold tabular-nums'
                style={{ color: isCurrent ? '#fff' : isPast ? '#34c759' : FAINT }}
              >
                ${tier.minUsd}+
              </span>
              <span
                className='text-[11px] tabular-nums'
                style={{ color: isCurrent ? 'rgba(255,255,255,0.8)' : FAINT }}
              >
                {tier.slots} {t('chances')}
              </span>
            </div>
          )
        })}
      </div>

      {/* 距下一档提示 */}
      {spendMet && gapToNext > 0 && (
        <p className='mt-3 text-center text-[12px]' style={{ color: FAINT }}>
          {t('Spend ${{gap}} more today to unlock {{slots}} chances tomorrow', {
            gap: gapToNext.toFixed(2),
            slots: nextTier?.slots,
          })}
        </p>
      )}
    </section>
  )
}

// ─── DrawTimeline — today's slots, iOS-progress quiet ───────────────────────
function DrawTimeline({
  activities,
  nextHour,
  nextMinute,
}: {
  activities: LuckyBagActivity[]
  nextHour: number
  nextMinute: number
}) {
  const { t } = useTranslation()
  const slots = [...activities]
    .sort((a, b) => a.slot_hour - b.slot_hour || a.slot_minute - b.slot_minute)
    .map((a) => ({
      hour: a.slot_hour,
      minute: a.slot_minute,
      label: `${pad(a.slot_hour)}:${pad(a.slot_minute)}`,
      activity: a,
    }))

  if (slots.length === 0) return null

  const drawnCount = slots.filter((s) => s.activity.status === 'drawn').length
  const progressRatio = slots.length <= 1 ? 0 : Math.min(1, drawnCount / (slots.length - 1))

  return (
    <section className={cn(CARD, 'p-6 sm:p-8')}>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-24'
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.7), transparent)' }}
      />
      <div className='mb-8 flex items-baseline justify-between gap-4'>
        <h2 className='text-[17px] font-semibold' style={{ color: INK }}>
          {t("Today's Draw Progress")}
        </h2>
        <span className='text-sm tabular-nums' style={{ color: FAINT }}>
          {drawnCount} / {slots.length}
        </span>
      </div>

      <ol className='relative flex'>
        {/* rail + progress fill */}
        <div
          aria-hidden
          className='absolute left-0 right-0 top-[4px] h-[3px] rounded-full'
          style={{
            background: 'linear-gradient(180deg, #dedee3, #f6f6f8)',
            boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.08)',
          }}
        />
        <div
          aria-hidden
          className='absolute left-0 top-[4px] h-[3px] rounded-full transition-[width] duration-700 ease-out'
          style={{
            width: `${progressRatio * 100}%`,
            background: 'linear-gradient(180deg, #3a3a3c, #1d1d1f)',
            boxShadow: '0 4px 10px rgba(29,29,31,0.12)',
          }}
        />

        {slots.map((slot, idx) => {
          const activity = slot.activity
          const isDrawn = activity.status === 'drawn'
          const slotKey = slot.hour * 60 + slot.minute
          const now = new Date()
          const nowKey = now.getHours() * 60 + now.getMinutes()
          const isPastTime = nowKey >= slotKey
          const isNext =
            !isDrawn && !isPastTime && slot.hour === nextHour && slot.minute === nextMinute
          const isAwaiting = !isDrawn && isPastTime
          const winners = [
            activity.winner_name,
            activity.winner2_name,
            activity.winner3_name,
          ].filter(Boolean)
          const winnerDisplay = winners.length > 0 ? splitWinnerDisplayName(winners[0]) : null

          let statusNode: React.ReactNode
          if (isDrawn) {
            statusNode = winnerDisplay ? (
              <span
                className='block max-w-full truncate'
                style={{ color: GRAY }}
                title={winners.join(' / ')}
              >
                {winnerDisplay.name}
                {winners.length > 1 && (
                  <span style={{ color: FAINT }}> +{winners.length - 1}</span>
                )}
              </span>
            ) : (
              <span style={{ color: FAINT }}>{t('No entries')}</span>
            )
          } else if (isNext) {
            statusNode = (
              <span className='font-medium' style={{ color: BLUE }}>
                {t('Up Next')}
              </span>
            )
          } else if (isAwaiting) {
            statusNode = <span style={{ color: FAINT }}>{t('Drawing...')}</span>
          } else {
            statusNode = <span style={{ color: '#aeaeb2' }}>{t('Pending')}</span>
          }

          return (
            <li key={`${slot.hour}-${slot.minute}-${idx}`} className='relative min-w-0 flex-1'>
              <span
                className='relative z-10 block size-[11px] rounded-full'
                style={
                  isDrawn
                    ? { background: INK }
                    : isNext
                      ? {
                          background: BLUE,
                          boxShadow: '0 0 0 4px rgba(0,113,227,0.15)',
                        }
                      : { background: '#fff', boxShadow: `inset 0 0 0 2px #d2d2d7` }
                }
              />
              <p
                className={cn('mt-4 text-[15px] tabular-nums', isNext && 'font-semibold')}
                style={{ color: isDrawn || isNext ? INK : FAINT }}
              >
                {slot.label}
              </p>
              <p className='mt-0.5 pr-3 text-[13px] leading-5'>{statusNode}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

// ─── Hero — eyebrow, headline, countdown, one button. Centered, airy. ───────
function HeroSection({
  statusData,
  entered,
  entering,
  onEnter,
  drawAnimationPhase,
  onDrawTime,
  eligibility,
}: {
  statusData: LuckyBagStatusResponse | null
  entered: boolean
  entering: boolean
  onEnter: () => void
  drawAnimationPhase: DrawAnimationPhase
  onDrawTime: () => void
  eligibility?: EligibilityInfo | null
}) {
  const { t } = useTranslation()
  const {
    hour: nextHour,
    minute: nextMinute,
    h,
    m,
    s,
  } = useNextDrawCountdown(statusData?.draw_slots, onDrawTime)

  const todayFinished = statusData?.today_finished ?? false
  const isNextDrawn = statusData?.next_activity?.status === 'drawn'
  const participantCount = statusData?.participant_count ?? 0
  const drawBusy = drawAnimationPhase !== 'idle'
  const slotLabel = `${pad(nextHour)}:${pad(nextMinute)}`

  return (
    <>
      <section className='flex flex-col items-center text-center'>
        <h1
          className='max-w-2xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl sm:leading-[1.08]'
          style={{
            color: INK,
            fontFamily:
              '"SF Pro Display", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Helvetica Neue", Arial, sans-serif',
          }}
        >
          {t('Every win is a gift from fate')}
        </h1>
        <p className='mt-4 text-[17px]' style={{ color: GRAY }}>
          {todayFinished
            ? t('Next draw: Tomorrow {{slot}}', { slot: slotLabel })
            : `${t('Next Draw')} ${slotLabel}`}
        </p>

        <div
          className='relative mt-12 flex items-start gap-2 rounded-[36px] border border-white/80 bg-white/35 p-2 shadow-[0_28px_80px_rgba(29,29,31,0.09)] backdrop-blur-xl sm:gap-3 sm:p-3'
          style={{
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.6), rgba(255,255,255,0.26))',
          }}
        >
          <span
            aria-hidden
            className='pointer-events-none absolute inset-x-8 top-0 h-px'
            style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)' }}
          />
          <CountdownUnit value={h} label={t('Hours')} />
          <CountdownColon />
          <CountdownUnit value={m} label={t('Minutes')} />
          <CountdownColon />
          <CountdownUnit value={s} label={t('Seconds')} />
        </div>

        <div className='mt-12 flex flex-col items-center gap-4'>
          <HeroCta
            entered={entered}
            entering={entering}
            todayFinished={todayFinished}
            isNextDrawn={isNextDrawn}
            drawBusy={drawBusy}
            eligibility={eligibility ?? null}
            onEnter={onEnter}
          />
          <p className='text-[13px] leading-5' style={{ color: FAINT }}>
            {t('Registered Participants')}{' '}
            <span className='font-medium tabular-nums' style={{ color: GRAY }}>
              {participantCount.toLocaleString()}
            </span>
            {!todayFinished && !entered && (
              <>
                <span className='mx-1.5'>·</span>
                {t('One ticket per draw · Free to enter')}
              </>
            )}
          </p>
        </div>
      </section>

      <div className='mt-20'>
        <DrawTimeline
          activities={statusData?.today_activities ?? []}
          nextHour={nextHour}
          nextMinute={nextMinute}
        />
      </div>
    </>
  )
}

// ─── Result Dialog: Winner — Apple sheet: white, centered, one blue button ──
function WinnerCard({ card, onClose }: { card: LuckyBagResultCard; onClose: () => void }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const rank = card.winner_rank || 1
  const winnerQuota =
    rank === 1
      ? card.activity.winner_quota
      : rank === 2
        ? card.activity.winner2_quota
        : card.activity.winner3_quota
  const winnerCode =
    rank === 1
      ? card.activity.winner_code
      : rank === 2
        ? card.activity.winner2_code
        : card.activity.winner3_code

  const handleCopy = async () => {
    await copyToClipboard(winnerCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className='relative overflow-hidden rounded-[28px] bg-white/92 shadow-[0_28px_80px_rgba(0,0,0,0.2)] backdrop-blur-xl'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-28'
        style={{ background: 'linear-gradient(180deg, rgba(0,113,227,0.08), transparent)' }}
      />
      <button
        type='button'
        onClick={onClose}
        className='absolute right-4 top-4 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full bg-[#f5f5f7] text-[#86868b] transition-colors hover:bg-[#e8e8ed] hover:text-[#1d1d1f]'
        aria-label='Close'
      >
        <X className='size-4' />
      </button>

      <div className='relative px-8 pb-8 pt-12 text-center'>
        {/* check medallion — the only celebratory mark */}
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
          className='mx-auto flex size-14 items-center justify-center rounded-full'
          style={{
            background: 'linear-gradient(180deg, rgba(0,113,227,0.14), rgba(0,113,227,0.06))',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7), 0 14px 30px rgba(0,113,227,0.16)',
          }}
        >
          <Check className='size-7' style={{ color: BLUE }} strokeWidth={2.5} />
        </motion.div>

        <h2 className='mt-5 text-2xl font-semibold tracking-tight' style={{ color: INK }}>
          {t('Congratulations, you won!')}
        </h2>
        <p className='mt-1.5 text-[13px] tabular-nums' style={{ color: FAINT }}>
          {t('Place {{rank}}', { rank })}
          <span className='mx-1.5'>·</span>
          {card.activity.draw_date}
          <span className='mx-1.5'>·</span>
          {pad(card.activity.slot_hour)}:{pad(card.activity.slot_minute)}
        </p>

        <p
          className='mt-8 text-[3.25rem] font-light leading-none tracking-[-0.02em] tabular-nums'
          style={{ color: INK }}
        >
          {formatQuota(winnerQuota)}
        </p>
        <p className='mt-2 text-[13px]' style={{ color: FAINT }}>
          {t('Prize Amount')}
        </p>

        <div
          className='mt-8 rounded-2xl border border-white/80 bg-[#f5f5f7] p-4 text-left'
          style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.9)' }}
        >
          <p className='text-[11px] font-medium' style={{ color: FAINT }}>
            {t('Redemption Code')}
          </p>
          <p
            className='mt-1.5 select-all break-all font-mono text-[13px] leading-relaxed'
            style={{ color: INK }}
          >
            {winnerCode}
          </p>
        </div>

        <button
          type='button'
          onClick={handleCopy}
          className='mt-5 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full text-[15px] font-normal text-white transition-colors duration-200'
          style={{ background: copied ? '#34c759' : BLUE }}
        >
          {copied ? (
            <>
              <Check className='size-4' />
              {t('Copied')}
            </>
          ) : (
            <>
              <Copy className='size-4' />
              {t('Copy Code')}
            </>
          )}
        </button>
        <p className='mt-4 text-[12px] leading-relaxed' style={{ color: FAINT }}>
          {t('Go to Wallet → Redemption Code, enter the code above to receive your credit')}
        </p>
      </div>
    </div>
  )
}

// ─── Result Dialog: no win — same sheet, quieter ────────────────────────────
function LoserCard({ card, onClose }: { card: LuckyBagResultCard; onClose: () => void }) {
  const { t } = useTranslation()

  return (
    <div className='relative overflow-hidden rounded-[28px] bg-white/92 shadow-[0_28px_80px_rgba(0,0,0,0.2)] backdrop-blur-xl'>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-24'
        style={{ background: 'linear-gradient(180deg, rgba(142,142,147,0.09), transparent)' }}
      />
      <button
        type='button'
        onClick={onClose}
        className='absolute right-4 top-4 z-10 flex size-8 cursor-pointer items-center justify-center rounded-full bg-[#f5f5f7] text-[#86868b] transition-colors hover:bg-[#e8e8ed] hover:text-[#1d1d1f]'
        aria-label='Close'
      >
        <X className='size-4' />
      </button>

      <div className='relative px-8 pb-8 pt-12 text-center'>
        <h2 className='text-2xl font-semibold tracking-tight' style={{ color: INK }}>
          {t("Sorry, you didn't win this time")}
        </h2>
        <p className='mt-1.5 text-[13px] tabular-nums' style={{ color: FAINT }}>
          {card.activity.draw_date}
          <span className='mx-1.5'>·</span>
          {pad(card.activity.slot_hour)}:{pad(card.activity.slot_minute)}
        </p>

        <p className='mt-6 text-[15px] leading-relaxed' style={{ color: GRAY }}>
          {t('Remember to enter earlier next time, good luck!')}
        </p>

        <button
          type='button'
          onClick={onClose}
          className='mt-8 flex h-12 w-full cursor-pointer items-center justify-center rounded-full text-[15px] font-normal text-white transition-colors duration-200'
          style={{ background: BLUE }}
        >
          {t('Got it')}
        </button>
      </div>
    </div>
  )
}

function ResultDialog({
  card,
  open,
  onClose,
}: {
  card: LuckyBagResultCard | null
  open: boolean
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {open && card && (
        <>
          <motion.div
            key='backdrop'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className='fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px]'
            onClick={onClose}
          />
          <motion.div
            key='dialog'
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className='fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 px-4'
          >
            {card.is_winner ? (
              <WinnerCard card={card} onClose={onClose} />
            ) : (
              <LoserCard card={card} onClose={onClose} />
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── History: one winner line ───────────────────────────────────────────────
function WinnerRow({
  name,
  quota,
  code,
  codeStatus,
  isMe,
  rank,
}: {
  name: string
  quota: number
  code: string
  codeStatus?: number
  isMe: boolean
  rank: number
}) {
  const { t } = useTranslation()
  const display = splitWinnerDisplayName(name)
  const [copied, setCopied] = useState(false)
  const isUsed = codeStatus === 3

  const handleCopy = async () => {
    await copyToClipboard(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className='flex items-start gap-3 py-2'>
      <span
        className='mt-0.5 w-4 shrink-0 text-[13px] tabular-nums'
        style={{ color: '#aeaeb2' }}
      >
        {rank}
      </span>
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-baseline gap-x-2 gap-y-0.5'>
          <span
            className='truncate text-[15px]'
            style={{ color: INK, fontWeight: isMe ? 600 : 400 }}
          >
            {display.name || t('Anonymous')}
          </span>
          {display.uid && (
            <span className='text-[12px] tabular-nums' style={{ color: FAINT }}>
              UID {display.uid}
            </span>
          )}
          {isMe && (
            <span
              className='rounded-full px-2 py-0.5 text-[11px] font-medium'
              style={{ background: 'rgba(0,113,227,0.08)', color: BLUE }}
            >
              {t('You')}
            </span>
          )}
        </div>
        {isMe && code && (
          <div className='mt-1.5 flex flex-wrap items-center gap-2'>
            <code
              className='select-all rounded-lg bg-[#f5f5f7] px-2 py-1 font-mono text-[12px]'
              style={{ color: INK }}
            >
              {code}
            </code>
            <span className='text-[12px]' style={{ color: isUsed ? '#aeaeb2' : GRAY }}>
              {isUsed ? t('Used') : t('Unused')}
            </span>
            {!isUsed && (
              <button
                type='button'
                onClick={handleCopy}
                className='flex cursor-pointer items-center gap-1 text-[12px] font-medium transition-opacity hover:opacity-70'
                style={{ color: BLUE }}
              >
                {copied ? (
                  <>
                    <Check className='size-3' />
                    {t('Copied')}
                  </>
                ) : (
                  <>
                    <Copy className='size-3' />
                    {t('Copy')}
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
      <span
        className='shrink-0 text-[15px] tabular-nums'
        style={{ color: INK, fontWeight: isMe ? 600 : 400 }}
      >
        {formatQuota(quota)}
      </span>
    </div>
  )
}

// ─── History: one drawn activity ────────────────────────────────────────────
function HistoryItem({ activity }: { activity: LuckyBagActivity }) {
  const { t } = useTranslation()
  const myRank = activity.my_winner_rank ?? 0

  const winners = [
    {
      name: activity.winner_name,
      quota: activity.winner_quota,
      code: activity.winner_code,
      codeStatus: activity.winner_code_status,
      rank: 1,
    },
    {
      name: activity.winner2_name,
      quota: activity.winner2_quota,
      code: activity.winner2_code,
      codeStatus: activity.winner2_code_status,
      rank: 2,
    },
    {
      name: activity.winner3_name,
      quota: activity.winner3_quota,
      code: activity.winner3_code,
      codeStatus: activity.winner3_code_status,
      rank: 3,
    },
  ].filter((w) => w.name)

  return (
    <div className='py-4'>
      <p className='text-[13px] tabular-nums' style={{ color: FAINT }}>
        {activity.draw_date}
        <span className='mx-1.5'>·</span>
        {pad(activity.slot_hour)}:{pad(activity.slot_minute)}
      </p>
      {winners.length === 0 ? (
        <p className='mt-1.5 text-[14px]' style={{ color: '#aeaeb2' }}>
          {t('No entries')}
        </p>
      ) : (
        <div className='mt-1'>
          {winners.map((w) => (
            <WinnerRow
              key={w.rank}
              name={w.name}
              quota={w.quota}
              code={w.code}
              codeStatus={w.codeStatus}
              isMe={myRank === w.rank}
              rank={w.rank}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── History list — iOS grouped-list card ───────────────────────────────────
function HistoryWinnersList({
  activities,
  loading,
  total,
  page,
  onPageChange,
}: {
  activities: LuckyBagActivity[]
  loading: boolean
  total: number
  page: number
  onPageChange: (p: number) => void
}) {
  const { t } = useTranslation()
  const pageSize = HISTORY_PAGE_SIZE
  const totalPages = Math.ceil(total / pageSize)

  return (
    <section className={cn(CARD, 'p-6 sm:p-8')}>
      <div
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-24'
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.72), transparent)' }}
      />
      <div
        className='relative flex items-baseline justify-between gap-4 border-b pb-5'
        style={{ borderColor: HAIRLINE }}
      >
        <div>
          <h2 className='text-[17px] font-semibold' style={{ color: INK }}>
            {t('Winning Records')}
          </h2>
          <p className='mt-0.5 text-[13px]' style={{ color: FAINT }}>
            {t('Recent draws · Anonymous winners')}
          </p>
        </div>
        {total > 0 && (
          <span className='text-sm tabular-nums' style={{ color: FAINT }}>
            {total}
          </span>
        )}
      </div>

      {loading ? (
        <div className='relative space-y-3 pt-5'>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className='h-12 w-full rounded-xl bg-black/[0.04]' />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <div className='flex min-h-[12rem] items-center justify-center'>
          <p className='text-[15px]' style={{ color: FAINT }}>
            {t('No history yet')}
          </p>
        </div>
      ) : (
        <ul className='relative divide-y' style={{ borderColor: HAIRLINE }}>
          {activities.map((a) => (
            <li key={a.id} style={{ borderColor: HAIRLINE }}>
              <HistoryItem activity={a} />
            </li>
          ))}
        </ul>
      )}

      {total > 0 && (
        <div
          className='relative flex items-center justify-between gap-2 border-t pt-4'
          style={{ borderColor: HAIRLINE }}
        >
          <span className='text-[13px] tabular-nums' style={{ color: FAINT }}>
            {t('{{from}}–{{to}} of {{total}}', {
              from: (page - 1) * pageSize + 1,
              to: Math.min(page * pageSize, total),
              total,
            })}
          </span>
          <div className='flex items-center gap-1'>
            <Button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              variant='ghost'
              size='icon'
              className='size-8 rounded-full text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] disabled:opacity-30'
            >
              <ChevronLeft className='size-4' />
            </Button>
            <span
              className='min-w-[3rem] text-center text-[13px] tabular-nums'
              style={{ color: GRAY }}
            >
              {page} / {Math.max(totalPages, 1)}
            </span>
            <Button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              variant='ghost'
              size='icon'
              className='size-8 rounded-full text-[#86868b] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] disabled:opacity-30'
            >
              <ChevronRight className='size-4' />
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Rules footnote ──────────────────────────────────────────────────────────
function RulesFootnote({ drawSlots }: { drawSlots?: { hour: number; minute: number }[] }) {
  const { t } = useTranslation()
  const slots =
    drawSlots && drawSlots.length > 0
      ? drawSlots
      : [
          { hour: 9, minute: 0 },
          { hour: 12, minute: 0 },
          { hour: 17, minute: 0 },
        ]
  const summary = t('{{count}} draws per day — {{slots}}', {
    count: slots.length,
    slots: slots.map((s) => `${pad(s.hour)}:${pad(s.minute)}`).join(' · '),
  })

  return (
    <p className='text-center text-[12px] leading-5' style={{ color: FAINT }}>
      {summary}
      <span className='mx-2'>·</span>
      {t('One ticket per draw · Free to enter')}
    </p>
  )
}

// ─── Dev-only Debug Panel ─────────────────────────────────────────────────────
// Tree-shaken in production: `import.meta.env.DEV` is statically replaced with
// `false` by Vite during build, so the entire panel is removed from the bundle.
function DebugPanel({
  statusData,
  onShowWinner,
  onShowLoser,
  onShowWinnerDirect,
  onShowLoserDirect,
  onSetAvailable,
  onSetEntered,
  onSetEntering,
  onSetTodayFinished,
  onSetNextDrawn,
  onSetHistorySamples,
  onSetHistoryMany,
  onSetHistoryEmpty,
  onSetHistoryLoading,
  onRefetchStatus,
  onClearViewed,
  onShowWinnerRank2,
  onShowWinnerRank3,
  onSetHistoryThreeWinners,
  onSetResultCardRank2,
  onSetResultCardRank3,
}: {
  statusData: LuckyBagStatusResponse | null
  onShowWinner: () => void
  onShowLoser: () => void
  onShowWinnerDirect: () => void
  onShowLoserDirect: () => void
  onSetAvailable: () => void
  onSetEntered: () => void
  onSetEntering: () => void
  onSetTodayFinished: () => void
  onSetNextDrawn: () => void
  onSetHistorySamples: () => void
  onSetHistoryMany: () => void
  onSetHistoryEmpty: () => void
  onSetHistoryLoading: () => void
  onRefetchStatus: () => void
  onClearViewed: () => void
  onShowWinnerRank2: () => void
  onShowWinnerRank3: () => void
  onSetHistoryThreeWinners: () => void
  onSetResultCardRank2: () => void
  onSetResultCardRank3: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const groups = [
    {
      title: '开奖流程',
      buttons: [
        { label: '中奖：开奖动画后弹窗', onClick: onShowWinner },
        { label: '未中奖：开奖动画后弹窗', onClick: onShowLoser },
        { label: '直接显示中奖弹窗', onClick: onShowWinnerDirect },
        { label: '直接显示未中奖弹窗', onClick: onShowLoserDirect },
        { label: '直接显示第2名弹窗', onClick: onShowWinnerRank2 },
        { label: '直接显示第3名弹窗', onClick: onShowWinnerRank3 },
      ],
    },
    {
      title: '报名按钮状态',
      buttons: [
        { label: '未报名：可参与', onClick: onSetAvailable },
        { label: '已报名：等待开奖', onClick: onSetEntered },
        { label: '报名中', onClick: onSetEntering },
        { label: '今日已结束', onClick: onSetTodayFinished },
        { label: '下一场已开奖', onClick: onSetNextDrawn },
      ],
    },
    {
      title: '右侧开奖记录',
      buttons: [
        { label: '显示示例记录', onClick: onSetHistorySamples },
        { label: '很多中奖记录分页', onClick: onSetHistoryMany },
        { label: '显示空记录', onClick: onSetHistoryEmpty },
        { label: '显示加载状态', onClick: onSetHistoryLoading },
      ],
    },
    {
      title: '多名中奖展示',
      buttons: [
        { label: '开奖记录：1/2/3名全部展示', onClick: onSetHistoryThreeWinners },
        { label: '结果卡：我是第2名', onClick: onSetResultCardRank2 },
        { label: '结果卡：我是第3名', onClick: onSetResultCardRank3 },
      ],
    },
    {
      title: '数据恢复',
      buttons: [
        { label: '清除已查看标记', onClick: onClearViewed },
        { label: '重新拉取真实数据', onClick: onRefetchStatus },
      ],
    },
  ]

  if (!expanded) {
    return (
      <Button
        type='button'
        variant='outline'
        size='sm'
        className='fixed bottom-3 left-3 z-40 h-8 border-black/10 bg-white/90 px-3 text-xs text-zinc-600 shadow-lg backdrop-blur hover:bg-black/[0.04]'
        onClick={() => setExpanded(true)}
      >
        打开测试面板
      </Button>
    )
  }

  return (
    <div className='fixed bottom-3 left-3 z-40 flex max-h-[min(34rem,calc(100vh-1.5rem))] max-w-[min(38rem,calc(100vw-1.5rem))] flex-col gap-2 overflow-y-auto rounded-2xl border border-black/8 bg-white/95 p-3 shadow-2xl backdrop-blur'>
      <div className='flex items-center gap-2'>
        <Bug className='size-3.5 text-zinc-400' />
        <p className='text-[10px] font-semibold uppercase tracking-wider text-zinc-400'>
          测试面板 · 仅开发环境
        </p>
        <span className='ml-auto text-[10px] tabular-nums text-zinc-400'>
          entered={String(statusData?.entered ?? false)} · finished=
          {String(statusData?.today_finished ?? false)}
        </span>
        <button
          type='button'
          className='ml-2 rounded-full border border-black/10 px-2 py-0.5 text-[10px] text-zinc-500 hover:bg-black/[0.04] hover:text-zinc-700'
          onClick={() => setExpanded(false)}
        >
          收起
        </button>
      </div>
      {groups.map((group) => (
        <div
          key={group.title}
          className='space-y-1.5 rounded-xl border border-black/6 bg-black/[0.02] p-2'
        >
          <p className='text-[10px] font-semibold text-zinc-500'>{group.title}</p>
          <div className='flex flex-wrap gap-1.5'>
            {group.buttons.map((b) => (
              <Button
                key={b.label}
                variant='outline'
                size='sm'
                className='h-7 border-black/10 bg-white px-2.5 text-xs text-zinc-600 hover:bg-black/[0.04]'
                onClick={b.onClick}
              >
                {b.label}
              </Button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export function LuckyBag() {
  const { t } = useTranslation()

  const [statusData, setStatusData] = useState<LuckyBagStatusResponse | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [entered, setEntered] = useState(false)
  const [entering, setEntering] = useState(false)

  const [historyActivities, setHistoryActivities] = useState<LuckyBagActivity[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [debugHistoryDataset, setDebugHistoryDataset] = useState<LuckyBagActivity[] | null>(null)

  const [dialogCard, setDialogCard] = useState<LuckyBagResultCard | null>(null)
  const [drawAnimationPhase, setDrawAnimationPhase] = useState<DrawAnimationPhase>('idle')
  const drawAnimationTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearDrawAnimationTimers = useCallback(() => {
    drawAnimationTimersRef.current.forEach((timer) => clearTimeout(timer))
    drawAnimationTimersRef.current = []
  }, [])

  const revealResultAfterBagAnimation = useCallback(
    (card: LuckyBagResultCard) => {
      clearDrawAnimationTimers()
      setDialogCard(null)
      setDrawAnimationPhase('shaking')

      const openingTimer = setTimeout(() => {
        setDrawAnimationPhase('opening')
      }, 900)
      const revealTimer = setTimeout(() => {
        setDrawAnimationPhase('idle')
        setDialogCard(card)
        drawAnimationTimersRef.current = []
      }, 1500)

      drawAnimationTimersRef.current = [openingTimer, revealTimer]
    },
    [clearDrawAnimationTimers],
  )

  useEffect(() => {
    return clearDrawAnimationTimers
  }, [clearDrawAnimationTimers])

  const fetchStatus = useCallback(async (autoPopDialog = false) => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.log('[LuckyBag] fetchStatus called', { autoPopDialog })
    }
    try {
      const res = await getLuckyBagStatus()
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[LuckyBag] fetchStatus response', {
          success: res.success,
          entered: res.data?.entered,
          nextActivity: res.data?.next_activity
            ? `id=${res.data.next_activity.id} ${res.data.next_activity.draw_date} ${pad(res.data.next_activity.slot_hour)}:${pad(res.data.next_activity.slot_minute)} status=${res.data.next_activity.status}`
            : null,
          resultCards: res.data?.result_cards?.map(
            (c) =>
              `id=${c.activity.id} winner=${c.is_winner} viewed=${c.winner_viewed} status=${c.activity.status}`,
          ),
          drawSlots: res.data?.draw_slots,
        })
      }
      if (res.success && res.data) {
        setStatusData(res.data)
        setEntered(res.data.entered)
        if (autoPopDialog) {
          const today = new Date().toISOString().slice(0, 10)
          const todayCard = (res.data.result_cards ?? []).find(
            (c) => c.activity.draw_date === today && !c.winner_viewed,
          )
          if (todayCard) setDialogCard(todayCard)
        }
      }
    } catch (e) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.error('[LuckyBag] fetchStatus error', e)
      }
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const fetchHistory = useCallback(async (page: number) => {
    setHistoryLoading(true)
    try {
      const res = await getLuckyBagHistory(page, 10)
      if (res.success && res.data) {
        setHistoryActivities(res.data.activities || [])
        setHistoryTotal(res.data.total || 0)
      }
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchStatus(true)
      fetchHistory(1)
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchStatus, fetchHistory])

  const handleEnter = async () => {
    if (entering || entered) return
    setEntering(true)
    try {
      const res = await enterLuckyBag()
      if (res.success) {
        setEntered(true)
        toast.success(t('Successfully entered the draw!'))
        fetchStatus()
      } else {
        toast.error(res.message || t('Failed to enter'))
      }
    } catch {
      toast.error(t('Request failed'))
    } finally {
      setEntering(false)
    }
  }

  const handlePageChange = (page: number) => {
    setHistoryPage(page)
    if (debugHistoryDataset) {
      const start = (page - 1) * HISTORY_PAGE_SIZE
      setHistoryActivities(debugHistoryDataset.slice(start, start + HISTORY_PAGE_SIZE))
      setHistoryTotal(debugHistoryDataset.length)
      setHistoryLoading(false)
      return
    }
    fetchHistory(page)
  }

  const handleDrawTime = useCallback(() => {
    const maxAttempts = 6
    let attempts = 0
    const drawSlots = statusData?.draw_slots ?? [
      { hour: 9, minute: 0 },
      { hour: 12, minute: 0 },
      { hour: 17, minute: 0 },
    ]
    const now = new Date()
    const nowKey = now.getHours() * 60 + now.getMinutes()
    const lastPassed = (() => {
      let best: { hour: number; minute: number } | null = null
      for (const s of drawSlots) {
        if (nowKey >= s.hour * 60 + s.minute) {
          if (!best || s.hour * 60 + s.minute > best.hour * 60 + best.minute) {
            best = { hour: s.hour, minute: s.minute }
          }
        }
      }
      return best
    })()
    const check = async () => {
      attempts += 1
      try {
        const res = await getLuckyBagStatus()
        if (res.success && res.data) {
          setStatusData(res.data)
          setEntered(res.data.entered)
          const today = new Date().toISOString().slice(0, 10)
          const latest =
            lastPassed &&
            (res.data.today_activities ?? []).find(
              (a) =>
                a.draw_date === today &&
                a.slot_hour === lastPassed.hour &&
                a.slot_minute === lastPassed.minute,
            )
          if (latest && latest.status === 'drawn') {
            const card = (res.data.result_cards ?? []).find(
              (c) =>
                c.activity.draw_date === today &&
                c.activity.slot_hour === lastPassed!.hour &&
                c.activity.slot_minute === lastPassed!.minute &&
                !c.winner_viewed,
            )
            if (card) revealResultAfterBagAnimation(card)
            fetchHistory(1)
            return
          }
        }
      } catch {
        // retry
      }
      if (attempts < maxAttempts) {
        setTimeout(check, 3000)
      }
    }
    setTimeout(check, 500)
  }, [fetchHistory, revealResultAfterBagAnimation, statusData?.draw_slots])

  // Synthesize a fake card for debug-only previewing of dialogs.
  const buildDebugCard = useCallback(
    (isWinner: boolean): LuckyBagResultCard => {
      const real = statusData?.today_activities?.[0]
      const today = new Date().toISOString().slice(0, 10)
      return {
        activity: buildDebugActivity({
          id: real?.id ?? -1,
          draw_date: real?.draw_date ?? today,
          slot_hour: real?.slot_hour ?? 12,
          slot_minute: real?.slot_minute ?? 0,
          status: 'drawn',
          winner_user_id: 1,
          winner_name: isWinner ? '你' : '测试用户（UID 42）',
          winner_quota: 5_000_000,
          winner_code: 'DEBUG-FAKE-CODE-XXXX-XXXX-XXXX-XXXX',
          drawn_at: Math.floor(Date.now() / 1000),
        }),
        is_winner: isWinner,
        winner_rank: isWinner ? 1 : 0,
        winner_viewed: false,
      }
    },
    [statusData],
  )

  const applyDebugStatus = useCallback(
    ({
      enteredValue,
      enteringValue = false,
      todayFinished = false,
      nextDrawn = false,
    }: {
      enteredValue: boolean
      enteringValue?: boolean
      todayFinished?: boolean
      nextDrawn?: boolean
    }) => {
      clearDrawAnimationTimers()
      setDialogCard(null)
      setDrawAnimationPhase('idle')
      setEntering(enteringValue)
      setEntered(enteredValue)
      setDebugHistoryDataset(null)

      const today = new Date().toISOString().slice(0, 10)
      const activities = [
        buildDebugActivity({
          id: -101,
          draw_date: today,
          slot_hour: 9,
          slot_minute: 0,
          status: 'drawn',
          winner_name: '陈测试（UID 1001）',
          winner_quota: 880_000,
          winner_code: 'DEBUG-HISTORY-0900',
          winner_code_status: 0,
          drawn_at: Math.floor(Date.now() / 1000) - 3600,
        }),
        buildDebugActivity({
          id: -102,
          draw_date: today,
          slot_hour: 12,
          slot_minute: 0,
          status: nextDrawn ? 'drawn' : 'pending',
          winner_name: nextDrawn ? '你' : '',
          winner_quota: nextDrawn ? 5_000_000 : 0,
          winner_code: nextDrawn ? 'DEBUG-NEXT-DRAWN' : '',
          winner_code_status: nextDrawn ? 1 : 0,
          drawn_at: nextDrawn ? Math.floor(Date.now() / 1000) : 0,
        }),
        buildDebugActivity({
          id: -103,
          draw_date: today,
          slot_hour: 17,
          slot_minute: 0,
          status: 'pending',
        }),
      ]

      setStatusData({
        today_activities: activities,
        next_activity: todayFinished ? null : activities[1],
        entered: enteredValue,
        weight: enteredValue ? 1 : 0,
        participant_count: enteredValue ? 1289 : 1288,
        result_cards: nextDrawn
          ? [
              {
                activity: activities[1],
                is_winner: true,
                winner_rank: 1,
                winner_viewed: false,
              },
            ]
          : [],
        draw_slots: [
          { hour: 9, minute: 0 },
          { hour: 12, minute: 0 },
          { hour: 17, minute: 0 },
        ],
        today_finished: todayFinished,
      })
    },
    [clearDrawAnimationTimers],
  )

  const applyDebugHistorySamples = useCallback(() => {
    setDebugHistoryDataset(null)
    setHistoryLoading(false)
    setHistoryPage(1)
    setHistoryTotal(10)
    setHistoryActivities(
      Array.from({ length: 10 }).map((_, index) =>
        buildDebugActivity({
          id: -300 - index,
          slot_hour: [9, 12, 17][index % 3],
          slot_minute: 0,
          status: 'drawn',
          winner_user_id: index + 1,
          winner_name:
            index === 1
              ? '你'
              : ['赵一（UID 1001）', '钱二（UID 1002）', '孙三（UID 1003）', '李四（UID 1004）'][
                  index % 4
                ],
          winner_quota: [880_000, 1_880_000, 5_000_000, 660_000][index % 4],
          winner_code: `DEBUG-CODE-${String(index + 1).padStart(2, '0')}`,
          winner_code_status: index === 1 ? 1 : 0,
          drawn_at: Math.floor(Date.now() / 1000) - index * 1800,
        }),
      ),
    )
  }, [])

  const buildDebugHistoryRecords = useCallback((count: number) => {
    const names = [
      '赵一（UID 1001）',
      '钱二（UID 1002）',
      '孙三（UID 1003）',
      '李四（UID 1004）',
      '周五（UID 1005）',
      '吴六（UID 1006）',
      '郑七（UID 1007）',
      '王八（UID 1008）',
    ]
    const quotas = [660_000, 880_000, 1_280_000, 1_880_000, 2_880_000, 5_000_000]
    const slots = [
      { hour: 9, minute: 0 },
      { hour: 12, minute: 0 },
      { hour: 17, minute: 0 },
    ]

    return Array.from({ length: count }).map((_, index) => {
      const slot = slots[index % slots.length]

      return buildDebugActivity({
        id: -500 - index,
        slot_hour: slot.hour,
        slot_minute: slot.minute,
        status: 'drawn',
        winner_user_id: index + 1,
        winner_name: index === 7 ? '你' : names[index % names.length],
        winner_quota: quotas[index % quotas.length],
        winner_code: `DEBUG-MANY-${String(index + 1).padStart(3, '0')}`,
        winner_code_status: index === 7 ? 1 : 0,
        drawn_at: Math.floor(Date.now() / 1000) - index * 1800,
      })
    })
  }, [])

  const applyDebugHistoryMany = useCallback(() => {
    const records = buildDebugHistoryRecords(37)
    setDebugHistoryDataset(records)
    setHistoryLoading(false)
    setHistoryPage(1)
    setHistoryTotal(records.length)
    setHistoryActivities(records.slice(0, HISTORY_PAGE_SIZE))
  }, [buildDebugHistoryRecords])

  const debugHandlers = useMemo(
    () => ({
      showWinner: () => revealResultAfterBagAnimation(buildDebugCard(true)),
      showLoser: () => revealResultAfterBagAnimation(buildDebugCard(false)),
      showWinnerDirect: () => setDialogCard(buildDebugCard(true)),
      showLoserDirect: () => setDialogCard(buildDebugCard(false)),
      setAvailable: () => applyDebugStatus({ enteredValue: false }),
      setEntered: () => applyDebugStatus({ enteredValue: true }),
      setEntering: () => applyDebugStatus({ enteredValue: false, enteringValue: true }),
      setTodayFinished: () => applyDebugStatus({ enteredValue: false, todayFinished: true }),
      setNextDrawn: () => applyDebugStatus({ enteredValue: false, nextDrawn: true }),
      setHistorySamples: applyDebugHistorySamples,
      setHistoryMany: applyDebugHistoryMany,
      setHistoryEmpty: () => {
        setDebugHistoryDataset(null)
        setHistoryLoading(false)
        setHistoryPage(1)
        setHistoryTotal(0)
        setHistoryActivities([])
      },
      setHistoryLoading: () => {
        setDebugHistoryDataset(null)
        setHistoryActivities([])
        setHistoryTotal(0)
        setHistoryLoading(true)
      },
      refetch: () => {
        setDebugHistoryDataset(null)
        setEntering(false)
        setHistoryLoading(false)
        fetchStatus(true)
        fetchHistory(1)
      },
      clearViewed: () => {
        setStatusData((prev) =>
          prev
            ? {
                ...prev,
                result_cards:
                  prev.result_cards?.map((c) => ({ ...c, winner_viewed: false })) ?? null,
              }
            : prev,
        )
      },
      // 第2/3名中奖弹窗
      showWinnerRank2: () => {
        const today = new Date().toISOString().slice(0, 10)
        setDialogCard({
          activity: buildDebugActivity({
            status: 'drawn',
            draw_date: today,
            winner_user_id: 99,
            winner_name: '赵一（UID 99）',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-RANK1-CODE-XXXX',
            winner2_user_id: 1,
            winner2_name: '你',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-RANK2-CODE-XXXX',
            winner3_user_id: 88,
            winner3_name: '王三（UID 88）',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-RANK3-CODE-XXXX',
            drawn_at: Math.floor(Date.now() / 1000),
          }),
          is_winner: true,
          winner_rank: 2,
          winner_viewed: false,
        })
      },
      showWinnerRank3: () => {
        const today = new Date().toISOString().slice(0, 10)
        setDialogCard({
          activity: buildDebugActivity({
            status: 'drawn',
            draw_date: today,
            winner_user_id: 99,
            winner_name: '赵一（UID 99）',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-RANK1-CODE-XXXX',
            winner2_user_id: 88,
            winner2_name: '李二（UID 88）',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-RANK2-CODE-XXXX',
            winner3_user_id: 1,
            winner3_name: '你',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-RANK3-CODE-XXXX',
            drawn_at: Math.floor(Date.now() / 1000),
          }),
          is_winner: true,
          winner_rank: 3,
          winner_viewed: false,
        })
      },
      // 开奖记录：1/2/3名全部展示
      setHistoryThreeWinners: () => {
        const today = new Date().toISOString().slice(0, 10)
        setDebugHistoryDataset(null)
        setHistoryLoading(false)
        setHistoryPage(1)
        setHistoryTotal(3)
        setHistoryActivities([
          buildDebugActivity({
            id: -901,
            draw_date: today,
            slot_hour: 9,
            slot_minute: 0,
            status: 'drawn',
            winner_user_id: 1,
            winner_name: '你',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-3W-RANK1',
            winner_code_status: 1,
            winner2_user_id: 42,
            winner2_name: '李**（UID 42）',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-3W-RANK2',
            winner3_user_id: 88,
            winner3_name: '王**（UID 88）',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-3W-RANK3',
            my_winner_rank: 1,
            drawn_at: Math.floor(Date.now() / 1000) - 3600,
          }),
          buildDebugActivity({
            id: -902,
            draw_date: today,
            slot_hour: 12,
            slot_minute: 0,
            status: 'drawn',
            winner_user_id: 55,
            winner_name: '张**（UID 55）',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-3W2-RANK1',
            winner2_user_id: 1,
            winner2_name: '你',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-3W2-RANK2',
            winner2_code_status: 1,
            winner3_user_id: 66,
            winner3_name: '陈**（UID 66）',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-3W2-RANK3',
            my_winner_rank: 2,
            drawn_at: Math.floor(Date.now() / 1000) - 1800,
          }),
          buildDebugActivity({
            id: -903,
            draw_date: today,
            slot_hour: 17,
            slot_minute: 0,
            status: 'drawn',
            winner_user_id: 77,
            winner_name: '孙**（UID 77）',
            winner_quota: 5_000_000,
            winner_code: 'DEBUG-3W3-RANK1',
            winner2_user_id: 88,
            winner2_name: '周**（UID 88）',
            winner2_quota: 3_000_000,
            winner2_code: 'DEBUG-3W3-RANK2',
            winner3_user_id: 99,
            winner3_name: '吴**（UID 99）',
            winner3_quota: 1_500_000,
            winner3_code: 'DEBUG-3W3-RANK3',
            my_winner_rank: 0,
            drawn_at: Math.floor(Date.now() / 1000) - 600,
          }),
        ])
      },
      // 结果卡：我中了第2/3名
      setResultCardRank2: () => {
        const today = new Date().toISOString().slice(0, 10)
        const activity = buildDebugActivity({
          id: -910,
          draw_date: today,
          slot_hour: 12,
          slot_minute: 0,
          status: 'drawn',
          winner_user_id: 55,
          winner_name: '张**（UID 55）',
          winner_quota: 5_000_000,
          winner_code: 'DEBUG-RC2-RANK1',
          winner2_user_id: 1,
          winner2_name: '你',
          winner2_quota: 3_000_000,
          winner2_code: 'DEBUG-RC2-MY-CODE',
          winner2_code_status: 1,
          winner3_user_id: 88,
          winner3_name: '王**（UID 88）',
          winner3_quota: 1_500_000,
          winner3_code: 'DEBUG-RC2-RANK3',
          my_winner_rank: 2,
          drawn_at: Math.floor(Date.now() / 1000),
        })
        setStatusData((prev) =>
          prev
            ? {
                ...prev,
                result_cards: [{ activity, is_winner: true, winner_rank: 2, winner_viewed: false }],
              }
            : prev,
        )
      },
      setResultCardRank3: () => {
        const today = new Date().toISOString().slice(0, 10)
        const activity = buildDebugActivity({
          id: -911,
          draw_date: today,
          slot_hour: 17,
          slot_minute: 0,
          status: 'drawn',
          winner_user_id: 55,
          winner_name: '张**（UID 55）',
          winner_quota: 5_000_000,
          winner_code: 'DEBUG-RC3-RANK1',
          winner2_user_id: 42,
          winner2_name: '李**（UID 42）',
          winner2_quota: 3_000_000,
          winner2_code: 'DEBUG-RC3-RANK2',
          winner3_user_id: 1,
          winner3_name: '你',
          winner3_quota: 1_500_000,
          winner3_code: 'DEBUG-RC3-MY-CODE',
          winner3_code_status: 1,
          my_winner_rank: 3,
          drawn_at: Math.floor(Date.now() / 1000),
        })
        setStatusData((prev) =>
          prev
            ? {
                ...prev,
                result_cards: [{ activity, is_winner: true, winner_rank: 3, winner_viewed: false }],
              }
            : prev,
        )
      },
    }),
    [
      applyDebugHistoryMany,
      applyDebugHistorySamples,
      applyDebugStatus,
      buildDebugCard,
      fetchHistory,
      fetchStatus,
      revealResultAfterBagAnimation,
      setDialogCard,
      setStatusData,
      setDebugHistoryDataset,
      setHistoryLoading,
      setHistoryPage,
      setHistoryTotal,
      setHistoryActivities,
    ],
  )

  return (
    <>
      <ResultDialog
        card={dialogCard}
        open={dialogCard !== null}
        onClose={() => {
          if (dialogCard && dialogCard.activity.id > 0) {
            markLuckyBagViewed(dialogCard.activity.id).catch(() => {})
          }
          setDialogCard(null)
        }}
      />
      <div
        className='relative h-full min-h-0 overflow-y-auto overflow-x-hidden'
        style={{
          background:
            'radial-gradient(900px 460px at 50% -12%, rgba(255,255,255,0.95), transparent 72%), radial-gradient(760px 420px at 15% 8%, rgba(0,113,227,0.09), transparent 60%), radial-gradient(740px 460px at 92% 20%, rgba(175,82,222,0.08), transparent 62%), linear-gradient(180deg, #fbfbfd 0%, #f5f5f7 44%, #f1f2f5 100%)',
          color: INK,
        }}
      >
        <div
          aria-hidden
          className='pointer-events-none absolute inset-x-0 top-0 h-[34rem] opacity-50 [mask-image:linear-gradient(to_bottom,black,transparent)]'
          style={{
            backgroundImage: 'radial-gradient(rgba(29,29,31,0.13) 0.7px, transparent 0.7px)',
            backgroundSize: '22px 22px',
          }}
        />
        <div
          aria-hidden
          className='pointer-events-none absolute left-1/2 top-12 h-40 w-[min(42rem,80vw)] -translate-x-1/2 rounded-full blur-3xl'
          style={{ background: 'rgba(255,255,255,0.78)' }}
        />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className='relative mx-auto w-full max-w-[1200px] px-5 pb-14 pt-14 sm:px-8 sm:pt-20'
        >
          {statusLoading ? (
            <div className='flex flex-col items-center gap-8'>
              <Skeleton className='h-4 w-24 bg-black/[0.05]' />
              <Skeleton className='h-12 w-2/3 max-w-md bg-black/[0.05]' />
              <Skeleton className='h-28 w-full max-w-lg bg-black/[0.05]' />
              <Skeleton className='h-12 w-44 rounded-full bg-black/[0.05]' />
              <Skeleton className='mt-10 h-40 w-full rounded-[20px] bg-black/[0.05]' />
            </div>
          ) : (
            <div className='grid grid-cols-1 gap-8 lg:grid-cols-[1fr_360px] lg:items-start'>
              {/* 左侧：倒计时 Hero + 场次进度 */}
              <div>
                <HeroSection
                  statusData={statusData}
                  entered={entered}
                  entering={entering}
                  onEnter={handleEnter}
                  drawAnimationPhase={drawAnimationPhase}
                  onDrawTime={handleDrawTime}
                  eligibility={statusData?.eligibility ?? null}
                />
              </div>
              {/* 右侧：参与资格面板 */}
              <div className='lg:sticky lg:top-6'>
                <EligibilityPanel eligibility={statusData?.eligibility ?? null} />
              </div>
            </div>
          )}

          <div className='mt-6'>
            <HistoryWinnersList
              activities={historyActivities}
              loading={historyLoading}
              total={historyTotal}
              page={historyPage}
              onPageChange={handlePageChange}
            />
          </div>

          <div className='mt-10'>
            <RulesFootnote drawSlots={statusData?.draw_slots} />
          </div>
        </motion.div>

        {import.meta.env.DEV && (
          <DebugPanel
            statusData={statusData}
            onShowWinner={debugHandlers.showWinner}
            onShowLoser={debugHandlers.showLoser}
            onShowWinnerDirect={debugHandlers.showWinnerDirect}
            onShowLoserDirect={debugHandlers.showLoserDirect}
            onSetAvailable={debugHandlers.setAvailable}
            onSetEntered={debugHandlers.setEntered}
            onSetEntering={debugHandlers.setEntering}
            onSetTodayFinished={debugHandlers.setTodayFinished}
            onSetNextDrawn={debugHandlers.setNextDrawn}
            onSetHistorySamples={debugHandlers.setHistorySamples}
            onSetHistoryMany={debugHandlers.setHistoryMany}
            onSetHistoryEmpty={debugHandlers.setHistoryEmpty}
            onSetHistoryLoading={debugHandlers.setHistoryLoading}
            onRefetchStatus={debugHandlers.refetch}
            onClearViewed={debugHandlers.clearViewed}
            onShowWinnerRank2={debugHandlers.showWinnerRank2}
            onShowWinnerRank3={debugHandlers.showWinnerRank3}
            onSetHistoryThreeWinners={debugHandlers.setHistoryThreeWinners}
            onSetResultCardRank2={debugHandlers.setResultCardRank2}
            onSetResultCardRank3={debugHandlers.setResultCardRank3}
          />
        )}
      </div>
    </>
  )
}
