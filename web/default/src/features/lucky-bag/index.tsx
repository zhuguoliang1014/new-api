import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  Gift,
  Loader2,
  Lock,
  Sparkles,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Trans, useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { getLuckyBagHistory, getLuckyBagStatus, openLuckyBag } from './api'
import { useNextRefreshCountdown } from './hooks'
import type {
  EligibilityInfo,
  LuckyBagOpenRecord,
  LuckyBagStatusResponse,
  Tier,
} from './types'

const QUOTA_PER_USD = 500000

const quotaToUsd = (quota: number) => quota / QUOTA_PER_USD
const fmtUsd = (quota: number) => `$${quotaToUsd(quota).toFixed(2)}`
const pad2 = (n: number) => n.toString().padStart(2, '0')
const fmtCountdown = (h: number, m: number, s: number) =>
  `${pad2(h)}:${pad2(m)}:${pad2(s)}`
const fmtRecordTime = (unix: number) => {
  const d = new Date(unix * 1000)
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// ── 头部 ─────────────────────────────────────────────────────────
function PageHeader({
  eligibility,
}: {
  eligibility: EligibilityInfo
}) {
  const { t } = useTranslation()
  const { h, m, s, expired } = useNextRefreshCountdown(
    eligibility.next_refresh_unix
  )

  return (
    <header className='mb-6 flex flex-wrap items-end justify-between gap-3'>
      <div>
        <h1 className='text-[26px] font-semibold tracking-tight text-stone-900 sm:text-[30px]'>
          {t('Lucky Bag Benefits')}
        </h1>
        <p className='mt-1 text-sm text-stone-500'>
          {t('Spend today to unlock opening chances')}
        </p>
      </div>
      <div className='flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 shadow-sm'>
        <Clock className='size-3.5 text-stone-400' />
        <span>{t('Refresh in')}</span>
        <span className='font-semibold tabular-nums text-stone-900'>
          {expired ? '--:--:--' : fmtCountdown(h, m, s)}
        </span>
      </div>
    </header>
  )
}

// ── 主卡：进度条主导 ────────────────────────────────────────────
type ButtonState = 'ready' | 'opening' | 'noEligible' | 'noChances' | 'limitReached'

function HeroCard({
  eligibility,
  tiers,
  onOpen,
  isOpening,
  showcasePrize,
  showcaseError,
  onDismissResult,
  prizeMaxUsd,
  prizeMinUsd,
}: {
  eligibility: EligibilityInfo
  tiers: Tier[]
  onOpen: () => void
  isOpening: boolean
  showcasePrize: number | null
  showcaseError: string | null
  onDismissResult: () => void
  prizeMaxUsd: number
  prizeMinUsd: number
}) {
  const { t } = useTranslation()
  const todaySpendUsd = quotaToUsd(eligibility.today_spend_quota)
  const sortedTiers = useMemo(
    () => [...tiers].sort((a, b) => a.min_usd - b.min_usd),
    [tiers]
  )
  const maxTierUsd = sortedTiers[sortedTiers.length - 1]?.min_usd ?? 99.9
  const nextTier = sortedTiers.find((tier) => todaySpendUsd < tier.min_usd)
  const gapToNext = nextTier ? Math.max(0, nextTier.min_usd - todaySpendUsd) : 0
  const progressMax = maxTierUsd * 1.05
  const currentProgress = Math.min(
    100,
    (todaySpendUsd / progressMax) * 100
  )

  const state: ButtonState = (() => {
    if (isOpening) return 'opening'
    if (eligibility.eligible_slots === 0) return 'noEligible'
    if (eligibility.daily_limit_reached) return 'limitReached'
    if (eligibility.remaining_slots === 0) return 'noChances'
    return 'ready'
  })()

  const buttonLabel: string = (() => {
    switch (state) {
      case 'opening':
        return t('Opening...')
      case 'noEligible':
        return t('Insufficient today spend')
      case 'noChances':
        return t("Today's chances used up")
      case 'limitReached':
        return t('Daily $10 cap reached')
      default:
        return t('Open now')
    }
  })()

  const buttonDisabled = state !== 'ready'
  const showResultButton = showcasePrize !== null

  return (
    <section className='relative overflow-hidden rounded-3xl border border-stone-200/80 bg-white p-6 shadow-[0_10px_40px_rgba(120,113,108,0.08)] sm:p-8'>
      {/* 顶部：当前消费 + 奖品范围 */}
      <div className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <span className='inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200/70'>
            <Sparkles className='size-3' />
            {t('Today only')}
          </span>
          <p className='mt-3 text-xs font-medium tracking-wider text-stone-400 uppercase'>
            {t("Today's real spend")}
          </p>
          <p className='mt-0.5 flex items-baseline gap-2 text-stone-900'>
            <span className='text-[44px] leading-none font-semibold tracking-tight tabular-nums sm:text-[52px]'>
              ${todaySpendUsd.toFixed(2)}
            </span>
          </p>
        </div>
        <div className='text-right'>
          <p className='text-xs font-medium tracking-wider text-stone-400 uppercase'>
            {t('Up to')}
          </p>
          <AnimatePresence mode='wait'>
            {showcasePrize !== null ? (
              <motion.p
                key='prize'
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className='mt-0.5 text-[36px] leading-none font-semibold text-emerald-600 tabular-nums sm:text-[44px]'
              >
                +{fmtUsd(showcasePrize)}
              </motion.p>
            ) : (
              <motion.p
                key='max'
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className='mt-0.5 text-[36px] leading-none font-semibold text-stone-900 tabular-nums sm:text-[44px]'
              >
                ${prizeMaxUsd.toFixed(0)}
              </motion.p>
            )}
          </AnimatePresence>
          <p className='mt-1 text-xs text-stone-500'>
            {t('Always wins, starting from {{amount}}', {
              amount: `$${prizeMinUsd.toFixed(2)}`,
            })}
          </p>
        </div>
      </div>

      {/* 中央：超大进度条 + 4 档刻度 */}
      <TierProgressBar
        tiers={sortedTiers}
        todaySpendUsd={todaySpendUsd}
        currentProgress={currentProgress}
        progressMax={progressMax}
        currentSlots={eligibility.eligible_slots}
      />

      {/* 提示 + 按钮 */}
      <div className='mt-6 flex flex-wrap items-center justify-between gap-4'>
        <div className='min-w-0 flex-1'>
          {nextTier && gapToNext > 0 ? (
            <p className='text-[15px] text-stone-700'>
              <Trans
                i18nKey='Spend <amount>${{gap}}</amount> more to unlock {{count}} more chance'
                values={{
                  gap: gapToNext.toFixed(2),
                  count: nextTier.slots,
                }}
                components={{
                  amount: (
                    <span className='text-[20px] font-semibold tabular-nums text-amber-600' />
                  ),
                }}
              />
            </p>
          ) : eligibility.eligible_slots > 0 ? (
            <p className='inline-flex items-center gap-2 text-[15px] font-medium text-emerald-700'>
              <Check className='size-4' strokeWidth={2.6} />
              {t('Top tier reached, {{slots}} chances unlocked', {
                slots: eligibility.eligible_slots,
              })}
            </p>
          ) : null}
          <p className='mt-1 text-xs text-stone-500'>
            {t(
              'Today {{used}}/{{total}} chances used, {{remaining}} left',
              {
                used: eligibility.used_slots,
                total: eligibility.eligible_slots,
                remaining: eligibility.remaining_slots,
              }
            )}
            <span className='mx-1.5 text-stone-300'>·</span>
            {t("Today's earnings {{amount}}", {
              amount: fmtUsd(eligibility.today_won_quota),
            })}
          </p>
        </div>

        <div className='flex shrink-0 items-center gap-3'>
          <button
            type='button'
            onClick={() => {
              if (showResultButton) {
                onDismissResult()
                return
              }
              if (!buttonDisabled) onOpen()
            }}
            disabled={buttonDisabled && !showResultButton}
            className={cn(
              'inline-flex h-13 items-center justify-center gap-2 rounded-full px-7 text-[15px] font-semibold transition-all duration-200',
              buttonDisabled && !showResultButton
                ? 'cursor-not-allowed bg-stone-100 text-stone-400'
                : 'bg-stone-900 text-white shadow-[0_8px_20px_rgba(28,25,23,0.18)] hover:-translate-y-0.5 hover:bg-stone-800 hover:shadow-[0_12px_28px_rgba(28,25,23,0.24)]'
            )}
            style={{ height: '52px' }}
          >
            {state === 'opening' ? (
              <>
                <Loader2 className='size-4 animate-spin' />
                {buttonLabel}
              </>
            ) : showResultButton ? (
              eligibility.remaining_slots > 0 &&
              !eligibility.daily_limit_reached ? (
                <>
                  <Gift className='size-4' />
                  {t('Open another')}
                </>
              ) : (
                <>
                  <Check className='size-4' />
                  {t('Got it')}
                </>
              )
            ) : (
              <>
                <Gift className='size-4' />
                {buttonLabel}
                <ArrowRight className='size-4' />
              </>
            )}
          </button>
        </div>
      </div>
      {showcaseError && (
        <p className='mt-3 text-sm text-red-500'>{showcaseError}</p>
      )}
    </section>
  )
}

// ── 进度条 + 4 档刻度 ──────────────────────────────────────────
function TierProgressBar({
  tiers,
  todaySpendUsd,
  currentProgress,
  progressMax,
  currentSlots,
}: {
  tiers: Tier[]
  todaySpendUsd: number
  currentProgress: number
  progressMax: number
  currentSlots: number
}) {
  const { t } = useTranslation()

  return (
    <div className='mt-8'>
      {/* 上方刻度（数值） */}
      <div className='relative mb-2 h-5'>
        {tiers.map((tier) => {
          const left = Math.min(100, (tier.min_usd / progressMax) * 100)
          const reached = todaySpendUsd >= tier.min_usd
          return (
            <span
              key={tier.min_usd}
              className={cn(
                'absolute -translate-x-1/2 text-[11px] font-medium tabular-nums',
                reached ? 'text-stone-900' : 'text-stone-400'
              )}
              style={{ left: `${left}%` }}
            >
              ${tier.min_usd}
            </span>
          )
        })}
      </div>

      {/* 进度条 */}
      <div className='relative h-3 rounded-full bg-stone-100'>
        <motion.div
          className='absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500'
          initial={{ width: 0 }}
          animate={{ width: `${currentProgress}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
        {/* 当前位置游标 */}
        {currentProgress > 0 && currentProgress < 100 && (
          <motion.div
            className='absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-amber-500 shadow-[0_2px_8px_rgba(217,119,6,0.45)]'
            style={{ width: 18, height: 18 }}
            initial={{ left: 0 }}
            animate={{ left: `${currentProgress}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        )}
        {/* 档位节点 */}
        {tiers.map((tier) => {
          const left = Math.min(100, (tier.min_usd / progressMax) * 100)
          const reached = todaySpendUsd >= tier.min_usd
          return (
            <span
              key={tier.min_usd}
              className={cn(
                'absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full',
                reached ? 'bg-amber-600' : 'bg-stone-300'
              )}
              style={{ left: `${left}%` }}
            />
          )
        })}
      </div>

      {/* 下方刻度（次数） */}
      <div className='relative mt-3 h-12'>
        {tiers.map((tier) => {
          const left = Math.min(100, (tier.min_usd / progressMax) * 100)
          const reached = todaySpendUsd >= tier.min_usd
          const current = reached && currentSlots === tier.slots
          return (
            <div
              key={tier.min_usd}
              className='absolute -translate-x-1/2 text-center'
              style={{ left: `${left}%` }}
            >
              <div
                className={cn(
                  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
                  current
                    ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
                    : reached
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-stone-100 text-stone-500'
                )}
              >
                {reached ? (
                  <Check className='size-3' strokeWidth={3} />
                ) : (
                  <Lock className='size-2.5' strokeWidth={2.4} />
                )}
                {t('{{n}} chances', { n: tier.slots })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 资格细则 ────────────────────────────────────────────────────
function EligibilityNotes({
  eligibility,
}: {
  eligibility: EligibilityInfo
}) {
  const { t } = useTranslation()
  const todayWonUsd = quotaToUsd(eligibility.today_won_quota)
  const dailyLimitUsd = quotaToUsd(eligibility.daily_won_limit_quota)
  const capProgress =
    dailyLimitUsd > 0 ? Math.min(100, (todayWonUsd / dailyLimitUsd) * 100) : 0
  const eligible = eligibility.eligible_slots > 0

  return (
    <section className='rounded-3xl border border-stone-200/80 bg-white p-6 shadow-[0_10px_40px_rgba(120,113,108,0.06)] sm:p-7'>
      <header className='mb-5 flex items-center justify-between gap-3'>
        <h2 className='text-[18px] font-semibold tracking-tight text-stone-900'>
          {t('Eligibility')}
        </h2>
        <span
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium',
            eligible
              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
              : 'bg-stone-100 text-stone-500'
          )}
        >
          {eligible ? (
            <>
              <Check className='size-3' strokeWidth={3} />
              {t('Qualified')}
            </>
          ) : (
            t('Not qualified')
          )}
        </span>
      </header>

      <div className='space-y-3'>
        <NoteRow
          icon={<TrendingUp className='size-4' />}
          title={
            eligible
              ? t("Today's spend qualified")
              : t('Insufficient today spend')
          }
          status={eligible ? 'ok' : 'idle'}
        />
        <NoteRow
          icon={<Lock className='size-4' />}
          title={t(
            'Today {{used}}/{{total}} chances used, {{remaining}} left',
            {
              used: eligibility.used_slots,
              total: eligibility.eligible_slots,
              remaining: eligibility.remaining_slots,
            }
          )}
          status={eligibility.remaining_slots > 0 ? 'ok' : 'idle'}
        />
        <NoteRow
          icon={<Wallet className='size-4' />}
          title={t('Daily cap ${{cap}} per person', {
            cap: dailyLimitUsd.toFixed(0),
          })}
          status={eligibility.daily_limit_reached ? 'warn' : 'ok'}
          right={
            <span className='text-xs text-stone-500 tabular-nums'>
              ${todayWonUsd.toFixed(2)} / ${dailyLimitUsd.toFixed(2)}
            </span>
          }
          progress={capProgress}
        />
      </div>
    </section>
  )
}

function NoteRow({
  icon,
  title,
  status = 'ok',
  right,
  progress,
}: {
  icon: React.ReactNode
  title: React.ReactNode
  status?: 'ok' | 'idle' | 'warn'
  right?: React.ReactNode
  progress?: number
}) {
  const tone = {
    ok: 'bg-emerald-50 text-emerald-700',
    idle: 'bg-stone-100 text-stone-400',
    warn: 'bg-amber-50 text-amber-700',
  }[status]

  return (
    <div>
      <div className='flex items-center gap-3'>
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-lg',
            tone
          )}
        >
          {icon}
        </span>
        <p className='min-w-0 flex-1 truncate text-sm text-stone-800'>{title}</p>
        {right}
      </div>
      {progress !== undefined && (
        <div className='mt-2 ml-11 h-1.5 overflow-hidden rounded-full bg-stone-100'>
          <div
            className='h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500'
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  )
}

// ── 历史 ─────────────────────────────────────────────────────────
function HistoryList({
  records,
  loading,
  total,
}: {
  records: LuckyBagOpenRecord[]
  loading: boolean
  total: number
}) {
  const { t } = useTranslation()

  return (
    <section className='rounded-3xl border border-stone-200/80 bg-white p-6 shadow-[0_10px_40px_rgba(120,113,108,0.06)] sm:p-7'>
      <header className='mb-4 flex items-center justify-between gap-3'>
        <div>
          <h2 className='text-[18px] font-semibold tracking-tight text-stone-900'>
            {t('Recent openings')}
          </h2>
          <p className='mt-0.5 text-xs text-stone-500'>
            {t('Your most recent openings')}
          </p>
        </div>
        {total > 6 && (
          <button
            type='button'
            className='inline-flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-900'
          >
            {t('View more')}
            <ChevronRight className='size-3.5' />
          </button>
        )}
      </header>

      {loading ? (
        <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-12 rounded-xl bg-stone-100' />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className='flex min-h-24 items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-stone-50/40'>
          <p className='text-sm text-stone-400'>{t('No history yet')}</p>
        </div>
      ) : (
        <ul className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
          {records.slice(0, 6).map((record) => (
            <li
              key={record.id}
              className='flex items-center justify-between gap-3 rounded-xl bg-stone-50/60 px-4 py-3'
            >
              <div className='flex items-center gap-2.5 text-sm text-stone-500'>
                <Gift className='size-3.5 text-stone-400' />
                <span className='tabular-nums'>
                  {fmtRecordTime(record.opened_at)}
                </span>
              </div>
              <span className='text-base font-semibold text-emerald-600 tabular-nums'>
                +{fmtUsd(record.prize_quota)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── 骨架屏 ────────────────────────────────────────────────────────
function LuckyBagSkeleton() {
  return (
    <div className='space-y-5'>
      <Skeleton className='h-10 w-72 rounded-xl bg-stone-200/60' />
      <Skeleton className='h-72 w-full rounded-3xl bg-stone-200/60' />
      <div className='grid grid-cols-1 gap-5 lg:grid-cols-2'>
        <Skeleton className='h-56 rounded-3xl bg-stone-200/60' />
        <Skeleton className='h-56 rounded-3xl bg-stone-200/60' />
      </div>
    </div>
  )
}

// ── 主导出 ────────────────────────────────────────────────────────
export function LuckyBag() {
  const { t } = useTranslation()
  const [statusData, setStatusData] = useState<LuckyBagStatusResponse | null>(
    null
  )
  const [statusLoading, setStatusLoading] = useState(true)
  const [isOpening, setIsOpening] = useState(false)
  const [showcasePrize, setShowcasePrize] = useState<number | null>(null)
  const [showcaseError, setShowcaseError] = useState<string | null>(null)
  const [history, setHistory] = useState<LuckyBagOpenRecord[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await getLuckyBagStatus()
      if (res.success && res.data) setStatusData(res.data)
    } catch {
      // silent
    } finally {
      setStatusLoading(false)
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const res = await getLuckyBagHistory(1, 30)
      if (res.success && res.data) {
        setHistory(res.data.records || [])
        setHistoryTotal(res.data.total || 0)
      }
    } catch {
      // silent
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchStatus()
    fetchHistory()
  }, [fetchStatus, fetchHistory])

  const handleOpen = useCallback(async () => {
    if (isOpening) return
    setShowcaseError(null)
    setShowcasePrize(null)
    setIsOpening(true)
    const minDelay = new Promise((resolve) => setTimeout(resolve, 800))
    try {
      const [res] = await Promise.all([openLuckyBag(), minDelay])
      if (res.success && res.data) {
        setShowcasePrize(res.data.prize_quota)
        setStatusData((prev) =>
          prev
            ? {
                ...prev,
                eligibility: {
                  ...prev.eligibility,
                  used_slots: res.data.used_slots,
                  remaining_slots: res.data.remaining_slots,
                  today_won_quota: res.data.today_won_quota,
                  daily_limit_reached: res.data.daily_limit_reached,
                },
              }
            : prev
        )
        fetchHistory()
      } else {
        setShowcaseError(res.message || t('Failed to open'))
        toast.error(res.message || t('Failed to open'))
      }
    } catch {
      setShowcaseError(t('Request failed'))
      toast.error(t('Request failed'))
    } finally {
      setIsOpening(false)
    }
  }, [fetchHistory, isOpening, t])

  const handleDismissResult = useCallback(() => {
    setShowcasePrize(null)
    setShowcaseError(null)
  }, [])

  const prizeMinUsd = useMemo(
    () =>
      statusData?.prize_range
        ? quotaToUsd(statusData.prize_range.min_quota)
        : 0.3,
    [statusData]
  )
  const prizeMaxUsd = useMemo(
    () =>
      statusData?.prize_range
        ? quotaToUsd(statusData.prize_range.max_quota)
        : 2,
    [statusData]
  )

  return (
    <div className='relative h-full min-h-0 overflow-x-hidden overflow-y-auto bg-[#faf7f2]'>
      <div className='relative mx-auto w-full max-w-[1200px] px-4 pt-6 pb-12 sm:px-8 sm:pt-8'>
        {statusLoading || !statusData ? (
          <LuckyBagSkeleton />
        ) : (
          <>
            <PageHeader eligibility={statusData.eligibility} />
            <div className='space-y-5'>
              <HeroCard
                eligibility={statusData.eligibility}
                tiers={statusData.tiers}
                onOpen={handleOpen}
                isOpening={isOpening}
                showcasePrize={showcasePrize}
                showcaseError={showcaseError}
                onDismissResult={handleDismissResult}
                prizeMinUsd={prizeMinUsd}
                prizeMaxUsd={prizeMaxUsd}
              />
              <div className='grid grid-cols-1 gap-5 lg:grid-cols-2'>
                <EligibilityNotes eligibility={statusData.eligibility} />
                <HistoryList
                  records={history}
                  loading={historyLoading}
                  total={historyTotal}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
