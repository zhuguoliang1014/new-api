import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Gift, Sparkles, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { getLuckyBagStatus, openLuckyBag, getLuckyBagHistory } from './api'
import { useNextRefreshCountdown } from './hooks'
import type {
  EligibilityInfo,
  LuckyBagOpenRecord,
  LuckyBagStatusResponse,
  Tier,
} from './types'

// 500000 quota = $1
const QUOTA_PER_USD = 500000

function quotaToUsd(quota: number): number {
  return quota / QUOTA_PER_USD
}

function fmtUsd(quota: number): string {
  return `$${quotaToUsd(quota).toFixed(2)}`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function fmtRecordTime(unix: number): string {
  const d = new Date(unix * 1000)
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// ── 顶部蓝色 Hero 横幅 ─────────────────────────────────────────
function HeroBanner({
  prizeMaxUsd,
  prizeMinUsd,
  eligibility,
}: {
  prizeMaxUsd: number
  prizeMinUsd: number
  eligibility: EligibilityInfo
}) {
  const { t } = useTranslation()
  const { h, m, s, expired } = useNextRefreshCountdown(eligibility.next_refresh_unix)
  const remainingSlots = eligibility.remaining_slots

  // 计算距下一档差额
  const yesterdaySpendUsd = quotaToUsd(eligibility.yesterday_spend_quota)
  const TIERS_USD = [9.9, 29.9, 59.9, 99.9]
  const nextTierUsd = TIERS_USD.find((u) => yesterdaySpendUsd < u) ?? 0
  const gapUsd = nextTierUsd > 0 ? Math.max(0, nextTierUsd - yesterdaySpendUsd) : 0

  return (
    <div
      className='relative overflow-hidden rounded-3xl px-6 py-7 sm:px-10 sm:py-9'
      style={{
        background:
          'linear-gradient(135deg, #4f7ef0 0%, #5b8af2 35%, #45c0a8 100%)',
        boxShadow: '0 22px 60px rgba(79,126,240,0.28)',
      }}
    >
      {/* 背景装饰 */}
      <span
        aria-hidden
        className='pointer-events-none absolute -right-10 -top-10 size-44 rounded-full opacity-30 blur-3xl'
        style={{ background: 'rgba(255,255,255,0.6)' }}
      />
      <span
        aria-hidden
        className='pointer-events-none absolute -left-6 bottom-0 size-32 rounded-full opacity-20 blur-2xl'
        style={{ background: '#ffd84d' }}
      />

      <div className='relative grid grid-cols-1 items-center gap-6 lg:grid-cols-[1fr_auto]'>
        {/* 左：标题 + 最大可得 */}
        <div className='flex items-center gap-5'>
          <div
            className='hidden size-20 shrink-0 items-center justify-center rounded-2xl shadow-lg sm:flex'
            style={{
              background: 'rgba(255,255,255,0.18)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <Gift className='size-10 text-white' strokeWidth={1.6} />
          </div>
          <div className='min-w-0'>
            <span
              className='inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium text-white'
              style={{ background: 'rgba(255,255,255,0.22)' }}
            >
              {t('Up to')}
            </span>
            <p className='mt-2 flex items-baseline gap-2 text-white'>
              <span className='text-[44px] font-semibold leading-none tracking-tight tabular-nums sm:text-[56px]'>
                ${prizeMaxUsd.toFixed(0)}
              </span>
              <span className='text-[15px] font-medium opacity-90 sm:text-[17px]'>
                {t('balance')}
              </span>
            </p>
            <p className='mt-1.5 text-[13px] text-white/85 sm:text-[14px]'>
              {t('Always wins, starting from {{amount}}', {
                amount: `$${prizeMinUsd.toFixed(2)}`,
              })}
            </p>
          </div>
        </div>

        {/* 右：今日机会卡片 */}
        <div
          className='relative w-full rounded-2xl px-5 py-4 lg:w-[280px]'
          style={{
            background: 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(10px)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          <p className='text-[12px] font-medium text-white/80'>
            {t("Today's Chances")}
          </p>
          <p className='mt-1 flex items-baseline gap-1.5 text-white'>
            <span className='text-[36px] font-semibold leading-none tabular-nums'>
              {remainingSlots}
            </span>
            <span className='text-[13px] opacity-85'>{t('left')}</span>
          </p>

          {gapUsd > 0 ? (
            <div className='mt-2'>
              <div className='flex items-baseline justify-between gap-2 text-[12px] text-white/85'>
                <span>{t('To next tier')}</span>
                <span className='tabular-nums'>${gapUsd.toFixed(2)}</span>
              </div>
              <div
                className='mt-1.5 h-1 overflow-hidden rounded-full'
                style={{ background: 'rgba(255,255,255,0.2)' }}
              >
                <div
                  className='h-full rounded-full bg-white transition-all'
                  style={{
                    width: `${Math.max(0, Math.min(100, (yesterdaySpendUsd / nextTierUsd) * 100))}%`,
                  }}
                />
              </div>
            </div>
          ) : null}

          <p className='mt-2.5 flex items-center justify-between text-[11px] text-white/75'>
            <span>{t('Refreshes daily at 08:00')}</span>
            {!expired && (
              <span className='tabular-nums'>
                {pad2(h)}:{pad2(m)}:{pad2(s)}
              </span>
            )}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── 左下：开盒卡片 ─────────────────────────────────────────────
type OpenButtonState =
  | 'ready'           // 可开
  | 'opening'        // 开盒动画中
  | 'noEligible'     // 昨日消费不足
  | 'noChances'      // 今日机会用完
  | 'limitReached'   // 每日上限 $10

function OpenBoxCard({
  eligibility,
  onOpen,
  isOpening,
  showcasePrize,
  showcaseError,
  onDismissResult,
}: {
  eligibility: EligibilityInfo
  onOpen: () => void
  isOpening: boolean
  showcasePrize: number | null
  showcaseError: string | null
  onDismissResult: () => void
}) {
  const { t } = useTranslation()

  const state: OpenButtonState = (() => {
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
        return t('Insufficient yesterday spend')
      case 'noChances':
        return t("Today's chances used up")
      case 'limitReached':
        return t('Daily $10 cap reached')
      default:
        return t('Open today\'s bag')
    }
  })()

  const buttonDisabled = state !== 'ready'

  return (
    <section className='relative overflow-hidden rounded-3xl border border-black/5 bg-white px-6 py-7 shadow-sm sm:px-8'>
      <div className='flex items-baseline justify-between gap-2'>
        <h2 className='text-[16px] font-semibold text-zinc-900'>
          {t("Open today's bag")}
        </h2>
        <span className='rounded-full bg-zinc-100 px-2 py-0.5 text-[12px] tabular-nums text-zinc-600'>
          {t('{{n}} left today', { n: eligibility.remaining_slots })}
        </span>
      </div>

      {/* 中央礼物图 + 开盒动画 */}
      <div className='relative mt-6 flex h-44 items-center justify-center sm:h-52'>
        <AnimatePresence mode='wait'>
          {showcasePrize !== null ? (
            <motion.div
              key='prize'
              initial={{ scale: 0.5, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              className='flex flex-col items-center gap-2'
            >
              <Sparkles
                className='size-8 text-amber-500'
                strokeWidth={1.6}
              />
              <p className='flex items-baseline gap-1 text-[42px] font-semibold leading-none tabular-nums text-zinc-900 sm:text-[52px]'>
                <span className='text-[26px] sm:text-[32px]'>+</span>
                {fmtUsd(showcasePrize)}
              </p>
              <p className='text-[13px] text-zinc-500'>
                {t('Credited to your balance')}
              </p>
            </motion.div>
          ) : isOpening ? (
            <motion.div
              key='opening'
              animate={{ rotate: [-8, 8, -8, 8, 0], y: [0, -4, 0, -4, 0] }}
              transition={{ duration: 0.7, repeat: Infinity }}
            >
              <Gift
                className='size-24 text-blue-500 sm:size-28'
                strokeWidth={1.4}
              />
            </motion.div>
          ) : (
            <motion.div
              key='idle'
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3 }}
              className='relative'
            >
              <span
                aria-hidden
                className='pointer-events-none absolute inset-0 rounded-full blur-2xl'
                style={{
                  background:
                    'radial-gradient(circle, rgba(79,126,240,0.2), transparent 70%)',
                }}
              />
              <Gift
                className='relative size-24 sm:size-28'
                style={{ color: '#4f7ef0' }}
                strokeWidth={1.4}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 错误提示（资格内的临时错误） */}
      {showcaseError && (
        <p className='mt-1 text-center text-[12px] text-red-500'>
          {showcaseError}
        </p>
      )}

      {/* 开盒按钮 */}
      <button
        type='button'
        onClick={() => {
          if (showcasePrize !== null) {
            onDismissResult()
            return
          }
          if (!buttonDisabled) onOpen()
        }}
        disabled={buttonDisabled && showcasePrize === null}
        className={cn(
          'mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[15px] font-medium transition-all duration-200',
          buttonDisabled && showcasePrize === null
            ? 'cursor-not-allowed bg-zinc-100 text-zinc-400'
            : 'cursor-pointer text-white shadow-md hover:-translate-y-0.5',
        )}
        style={
          buttonDisabled && showcasePrize === null
            ? undefined
            : {
                background:
                  'linear-gradient(180deg, #5b8af2 0%, #4f7ef0 100%)',
                boxShadow: '0 12px 28px rgba(79,126,240,0.35)',
              }
        }
      >
        {state === 'opening' ? (
          <>
            <Loader2 className='size-4 animate-spin' />
            {buttonLabel}
          </>
        ) : showcasePrize !== null ? (
          eligibility.remaining_slots > 0 && !eligibility.daily_limit_reached
            ? t('Open another')
            : t('Got it')
        ) : (
          buttonLabel
        )}
      </button>

      <p className='mt-3 text-center text-[12px] tabular-nums text-zinc-500'>
        {t("Today's earnings {{amount}}", {
          amount: fmtUsd(eligibility.today_won_quota),
        })}
        <span className='mx-1.5 text-zinc-300'>·</span>
        {t('Per-person daily cap $10')}
      </p>

      {/* 三条规则 */}
      <div className='mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3'>
        {[
          t('Spend $9.9+ yesterday for 1 chance today'),
          t('Up to $2 per box, credited directly'),
          t('Per-person daily cap $10, while-supplies-last'),
        ].map((line, i) => (
          <div
            key={i}
            className='flex items-start gap-2 rounded-xl bg-zinc-50 px-3 py-2.5'
          >
            <span
              className='mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[11px] font-semibold text-emerald-600 tabular-nums'
            >
              {i + 1}
            </span>
            <span className='text-[12px] leading-snug text-zinc-600'>
              {line}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

// ── 右：参与资格面板 ────────────────────────────────────────────
function EligibilityPanel({
  eligibility,
  tiers,
}: {
  eligibility: EligibilityInfo
  tiers: Tier[]
}) {
  const { t } = useTranslation()
  const yesterdaySpendUsd = quotaToUsd(eligibility.yesterday_spend_quota)
  const eligible = eligibility.eligible_slots > 0
  const dailyLimitReached = eligibility.daily_limit_reached
  const todayWonUsd = quotaToUsd(eligibility.today_won_quota)
  const dailyLimitUsd = quotaToUsd(eligibility.daily_won_limit_quota)

  // 距下一档
  const sortedTiers = [...tiers].sort((a, b) => a.min_usd - b.min_usd)
  const nextTier = sortedTiers.find((t) => yesterdaySpendUsd < t.min_usd)
  const gapToNext = nextTier ? nextTier.min_usd - yesterdaySpendUsd : 0
  const currentTierSlots = eligibility.eligible_slots

  type RowStatus = 'met' | 'limited' | 'unmet'
  function Row({
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
    const palette = {
      met: { border: 'rgba(52,199,89,0.25)', bg: 'rgba(52,199,89,0.05)', icon: '#34c759', text: '#34c759' },
      limited: { border: 'rgba(255,149,0,0.28)', bg: 'rgba(255,149,0,0.06)', icon: '#ff9500', text: '#ff9500' },
      unmet: { border: 'rgba(0,0,0,0.08)', bg: 'rgba(255,255,255,0.6)', icon: '#aeaeb2', text: '#8e8e93' },
    }[status]
    return (
      <div
        className='flex min-w-0 items-start justify-between gap-3 rounded-2xl border p-3.5'
        style={{ borderColor: palette.border, background: palette.bg }}
      >
        <div className='flex min-w-0 flex-1 items-start gap-2.5'>
          <span
            className='mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full'
            style={{ background: palette.icon }}
          >
            <Check className='size-[10px] text-white' strokeWidth={3} />
          </span>
          <div className='min-w-0'>
            <p className='text-[14px] font-medium leading-snug text-zinc-900'>
              {main}
            </p>
            <p className='mt-0.5 text-[12px] leading-snug text-zinc-500'>
              {sub}
            </p>
          </div>
        </div>
        <span
          className='shrink-0 text-[13px] font-medium tabular-nums'
          style={{ color: palette.text }}
        >
          {badge}
        </span>
      </div>
    )
  }

  return (
    <section className='relative overflow-hidden rounded-3xl border border-black/5 bg-white px-5 py-6 shadow-sm sm:px-6'>
      <div className='mb-4 flex items-baseline justify-between gap-3'>
        <h2 className='text-[16px] font-semibold text-zinc-900'>
          {t('Eligibility')}
        </h2>
        <span
          className={cn(
            'rounded-full px-2.5 py-0.5 text-[12px] font-medium',
            eligible
              ? 'bg-emerald-50 text-emerald-600'
              : 'bg-zinc-100 text-zinc-500',
          )}
        >
          {eligible ? t('Eligible') : t('Not eligible')}
        </span>
      </div>

      <div className='space-y-2.5'>
        {/* 1. 消费门槛 */}
        <Row
          status={eligible ? 'met' : 'unmet'}
          main={t("Yesterday's real spend {{amount}}", {
            amount: `$${yesterdaySpendUsd.toFixed(2)}`,
          })}
          sub={t('API billing only, excludes gifted credit and manual top-ups')}
          badge={
            eligible
              ? t('Qualified')
              : gapToNext > 0
                ? `-$${gapToNext.toFixed(2)}`
                : t('Not qualified')
          }
        />

        {/* 2. 今日机会 */}
        <Row
          status={
            eligible && eligibility.remaining_slots > 0 ? 'met' : 'unmet'
          }
          main={
            eligible
              ? t("Today {{used}}/{{total}} chances used, {{remaining}} left", {
                  used: eligibility.used_slots,
                  total: eligibility.eligible_slots,
                  remaining: eligibility.remaining_slots,
                })
              : t('No chances today')
          }
          sub={t('More spend = more chances tomorrow, max 5 per day')}
          badge={`${eligibility.remaining_slots} ${t('chances')}`}
        />

        {/* 3. 每日上限 */}
        <Row
          status={dailyLimitReached ? 'limited' : eligible ? 'met' : 'unmet'}
          main={t('Daily cap ${{cap}} per person', {
            cap: dailyLimitUsd.toFixed(0),
          })}
          sub={t('Prevents over-claiming, controls activity cost')}
          badge={
            dailyLimitReached
              ? t('Capped')
              : eligible
                ? `$${todayWonUsd.toFixed(2)} / $${dailyLimitUsd.toFixed(0)}`
                : '-'
          }
        />
      </div>

      {/* 档位进度 */}
      <div
        className='mt-4 grid grid-cols-4 gap-1.5 rounded-2xl border p-2'
        style={{
          borderColor: 'rgba(0,0,0,0.06)',
          background: 'rgba(247,248,251,0.6)',
        }}
      >
        {sortedTiers.map((tier) => {
          const isCurrent = currentTierSlots === tier.slots
          const isPast = yesterdaySpendUsd >= tier.min_usd
          return (
            <div
              key={tier.min_usd}
              className='flex flex-col items-center gap-1 rounded-xl py-2'
              style={
                isCurrent
                  ? {
                      background: 'linear-gradient(180deg, #5b8af2 0%, #4f7ef0 100%)',
                      boxShadow: '0 6px 18px rgba(79,126,240,0.28)',
                    }
                  : isPast
                    ? { background: 'rgba(52,199,89,0.08)' }
                    : { background: 'transparent' }
              }
            >
              <span
                className='text-[13px] font-semibold tabular-nums'
                style={{
                  color: isCurrent ? '#fff' : isPast ? '#34c759' : '#8e8e93',
                }}
              >
                ${tier.min_usd}+
              </span>
              <span
                className='text-[11px] tabular-nums'
                style={{
                  color: isCurrent
                    ? 'rgba(255,255,255,0.85)'
                    : '#8e8e93',
                }}
              >
                {t('{{n}} chances', { n: tier.slots })}
              </span>
            </div>
          )
        })}
      </div>

      {eligible && nextTier && gapToNext > 0 && (
        <p className='mt-3 text-center text-[12px] text-zinc-500'>
          {t(
            'Spend ${{gap}} more today to get {{slots}} chances tomorrow',
            { gap: gapToNext.toFixed(2), slots: nextTier.slots },
          )}
        </p>
      )}

      {eligibility.next_refresh_unix > 0 && (
        <p className='mt-2 text-center text-[12px] text-zinc-400'>
          {t('Refreshes daily at 08:00')}
        </p>
      )}
    </section>
  )
}

// ── 历史开盒记录 ────────────────────────────────────────────
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
    <section className='relative overflow-hidden rounded-3xl border border-black/5 bg-white px-6 py-6 shadow-sm sm:px-8'>
      <div className='mb-4 flex items-baseline justify-between gap-2 border-b border-zinc-100 pb-4'>
        <div>
          <h2 className='text-[16px] font-semibold text-zinc-900'>
            {t('Recent Boxes')}
          </h2>
          <p className='mt-0.5 text-[12px] text-zinc-500'>
            {t('Your most recent openings')}
          </p>
        </div>
        {total > 0 && (
          <span className='text-[13px] tabular-nums text-zinc-400'>
            {total}
          </span>
        )}
      </div>

      {loading ? (
        <div className='space-y-2 pt-2'>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className='h-10 w-full rounded-xl bg-zinc-100' />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className='flex min-h-[8rem] items-center justify-center'>
          <p className='text-[14px] text-zinc-400'>{t('No history yet')}</p>
        </div>
      ) : (
        <ul className='divide-y divide-zinc-100'>
          {records.map((r) => (
            <li
              key={r.id}
              className='flex items-center justify-between gap-3 py-3'
            >
              <span className='text-[13px] tabular-nums text-zinc-500'>
                {fmtRecordTime(r.opened_at)}
              </span>
              <span className='text-[15px] font-semibold tabular-nums text-emerald-600'>
                +{fmtUsd(r.prize_quota)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── 主页面 ────────────────────────────────────────────────────
export function LuckyBag() {
  const { t } = useTranslation()
  const [statusData, setStatusData] = useState<LuckyBagStatusResponse | null>(
    null,
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
      if (res.success && res.data) {
        setStatusData(res.data)
      }
    } catch {
      // ignore
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
      // ignore
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchHistory()
  }, [fetchStatus, fetchHistory])

  const handleOpen = useCallback(async () => {
    if (isOpening) return
    setShowcaseError(null)
    setShowcasePrize(null)
    setIsOpening(true)

    // 让礼物图先抖动一会儿，然后才出结果
    const minDelay = new Promise((resolve) => setTimeout(resolve, 800))

    try {
      const [res] = await Promise.all([openLuckyBag(), minDelay])
      if (res.success && res.data) {
        setShowcasePrize(res.data.prize_quota)
        // 局部刷新状态（不再发一次 status 请求）
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
            : prev,
        )
        // 历史也更新
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
    [statusData],
  )
  const prizeMaxUsd = useMemo(
    () =>
      statusData?.prize_range
        ? quotaToUsd(statusData.prize_range.max_quota)
        : 2,
    [statusData],
  )

  return (
    <div
      className='relative h-full min-h-0 overflow-y-auto overflow-x-hidden'
      style={{
        background:
          'linear-gradient(180deg, #f6f8fb 0%, #eef2f7 100%)',
      }}
    >
      <div className='relative mx-auto w-full max-w-[1200px] px-4 pb-12 pt-8 sm:px-8 sm:pt-10'>
        {statusLoading || !statusData ? (
          <div className='space-y-6'>
            <Skeleton className='h-44 w-full rounded-3xl bg-zinc-200/60' />
            <div className='grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]'>
              <Skeleton className='h-96 w-full rounded-3xl bg-zinc-200/60' />
              <Skeleton className='h-96 w-full rounded-3xl bg-zinc-200/60' />
            </div>
          </div>
        ) : (
          <>
            {/* Hero 横幅 */}
            <HeroBanner
              prizeMinUsd={prizeMinUsd}
              prizeMaxUsd={prizeMaxUsd}
              eligibility={statusData.eligibility}
            />

            {/* 主体两栏 */}
            <div className='mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px] lg:items-start'>
              <OpenBoxCard
                eligibility={statusData.eligibility}
                onOpen={handleOpen}
                isOpening={isOpening}
                showcasePrize={showcasePrize}
                showcaseError={showcaseError}
                onDismissResult={handleDismissResult}
              />
              <EligibilityPanel
                eligibility={statusData.eligibility}
                tiers={statusData.tiers}
              />
            </div>

            {/* 历史 */}
            <div className='mt-6'>
              <HistoryList
                records={history}
                loading={historyLoading}
                total={historyTotal}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
