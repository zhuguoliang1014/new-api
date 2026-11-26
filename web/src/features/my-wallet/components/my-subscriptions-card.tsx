import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation } from '@tanstack/react-query'
import {
  CalendarClock,
  ArrowUp,
  ArrowDown,
  CreditCard,
  GripVertical,
  History,
  Layers,
  RefreshCw,
  Snowflake,
  Play,
} from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
  updateSubscriptionPriorities,
  updateBillingPreference,
  setSubscriptionFrozen,
} from '@/features/subscriptions/api'
import { DEFAULT_SUBSCRIPTION_GROUP } from '@/features/subscriptions/constants'
import type {
  BillingPreference,
  PlanRecord,
  UserSubscriptionRecord,
  SubscriptionFreezePolicy,
} from '@/features/subscriptions/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota } from '@/lib/format'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'

import { SubscriptionHistoryDialog } from './subscription-history-dialog'

function SubscriptionRow({
  record,
  planTitle,
  draggable,
  nowSec,
  freezeAllowed,
  freezePending,
  onFreeze,
  order,
  onMove,
  moveUpDisabled,
  moveDownDisabled,
}: {
  record: UserSubscriptionRecord
  planTitle: string
  draggable: boolean
  order?: number
  onMove?: (offset: number) => void
  moveUpDisabled?: boolean
  moveDownDisabled?: boolean
  nowSec: number
  freezeAllowed: boolean
  freezePending: boolean
  onFreeze: (id: number, frozen: boolean) => void
}) {
  const { t } = useTranslation()
  const subscription = record.subscription
  const id = subscription?.id ?? 0
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !draggable || freezePending })
  const now = nowSec
  const isExpired = (subscription.end_time || 0) < now
  const isCancelled = subscription.status === 'cancelled'
  const isActive = subscription.status === 'active' && !isExpired
  const isFrozen = subscription.status === 'frozen'
  let statusVariant: 'success' | 'info' | 'neutral' = 'neutral'
  let statusLabel = t('Expired')
  let endLabel = t('Expired at')
  if (isFrozen) {
    statusVariant = 'info'
    statusLabel = t('Frozen')
    endLabel = t('Frozen since')
  } else if (isActive) {
    statusVariant = 'success'
    statusLabel = t('Active')
    endLabel = t('Until')
  } else if (isCancelled) {
    statusLabel = t('Cancelled')
    endLabel = t('Cancelled at')
  }
  const totalAmount = Number(subscription.amount_total || 0)
  const usedAmount = Number(subscription.amount_used || 0)
  const remainingAmount =
    totalAmount > 0 ? Math.max(0, totalAmount - usedAmount) : 0
  const usagePercent =
    totalAmount > 0 ? Math.round((usedAmount / totalAmount) * 100) : 0
  const remainingDays = Math.max(
    0,
    Math.ceil(
      ((subscription.end_time || 0) -
        (isFrozen ? subscription.frozen_at || now : now)) /
        86400
    )
  )

  return (
    <div
      ref={setNodeRef}
      role='listitem'
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'group bg-muted/20 relative min-w-0 rounded-lg border transition-shadow',
        isActive && 'border-border',
        !isActive && !isFrozen && 'border-dashed opacity-70',
        isFrozen && 'border-dashed',
        isDragging && 'z-10 shadow-lg ring-1 ring-primary/40'
      )}
    >
      <div
        data-slot='subscription-row-content'
        className='grid min-w-0 gap-3 p-3 sm:p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] md:items-center md:gap-x-6'
      >
        <div className='min-w-0'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <div className='min-w-0 flex-1'>
              <span className='text-sm font-semibold break-words'>
                {order !== undefined && (
                  <span
                    className='text-muted-foreground mr-2'
                    aria-hidden='true'
                  >
                    {formatNumber(order)}.
                  </span>
                )}
                {planTitle || t('Subscription')}
              </span>
            </div>
            <StatusBadge
              label={statusLabel}
              variant={statusVariant}
              copyable={false}
            />
          </div>

          <p className='text-muted-foreground mt-1 text-xs break-words'>
            {t('Subscription groups: {{groups}}', {
              groups: (
                record.plan?.allowed_groups ?? [DEFAULT_SUBSCRIPTION_GROUP]
              ).join('、'),
            })}
          </p>

          <div className='mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
            <span className='text-muted-foreground inline-flex items-center gap-1'>
              <CalendarClock className='size-3.5' />
              {endLabel}{' '}
              <span className='text-foreground/80'>
                {new Date(
                  (isFrozen
                    ? subscription.frozen_at || 0
                    : subscription.end_time) * 1000
                ).toLocaleDateString()}
              </span>
            </span>
            {isActive || isFrozen ? (
              <span className='text-foreground/90 font-medium tabular-nums'>
                {t('{{count}} days remaining', { count: remainingDays })}
              </span>
            ) : null}
          </div>
        </div>

        {totalAmount > 0 ? (
          <div data-slot='subscription-usage' className='min-w-0'>
            <div className='text-muted-foreground mb-1.5 flex flex-wrap items-center justify-between gap-x-2 text-xs'>
              <span className='inline-flex items-center gap-1'>
                <CreditCard className='size-3' />
                {formatQuota(usedAmount)} / {formatQuota(totalAmount)}
              </span>
              <span className='tabular-nums'>{usagePercent}%</span>
            </div>
            <Progress
              value={usagePercent}
              aria-label={t('Available Quota')}
              className='h-1.5'
            />
            {isActive || isFrozen ? (
              <div className='text-muted-foreground mt-1.5 text-xs'>
                {t('Remaining')} {formatQuota(remainingAmount)}
              </div>
            ) : null}
          </div>
        ) : (
          <div className='text-muted-foreground/70 mt-2 inline-flex items-center gap-1 text-xs'>
            <Layers className='size-3' />
            {t('Unlimited')}
          </div>
        )}
        <div
          data-slot='subscription-row-actions'
          className='border-border/60 flex min-w-0 items-center justify-between gap-2 border-t pt-2 md:col-span-2'
        >
          {draggable && (
            <div
              data-slot='subscription-order-controls'
              className='flex shrink-0 items-center gap-1'
            >
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-10'
                aria-label={t('Move {{title}} up', {
                  title: planTitle || t('Subscription'),
                })}
                disabled={moveUpDisabled}
                onClick={() => onMove?.(-1)}
              >
                <ArrowUp className='size-4' aria-hidden='true' />
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='text-muted-foreground size-10 cursor-grab touch-none active:cursor-grabbing'
                aria-label={t('Drag to reorder')}
                disabled={freezePending}
                {...attributes}
                {...listeners}
              >
                <GripVertical className='size-4' aria-hidden='true' />
              </Button>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='size-10'
                aria-label={t('Move {{title}} down', {
                  title: planTitle || t('Subscription'),
                })}
                disabled={moveDownDisabled}
                onClick={() => onMove?.(1)}
              >
                <ArrowDown className='size-4' aria-hidden='true' />
              </Button>
            </div>
          )}

          {isActive || isFrozen ? (
            <div className='ml-auto flex min-w-0 justify-end'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-auto min-h-10 max-w-full min-w-0 shrink px-3 py-2 text-xs whitespace-normal sm:text-sm'
                disabled={freezePending || (!isFrozen && !freezeAllowed)}
                aria-label={
                  isFrozen
                    ? t('Resume {{plan}}', {
                        plan: planTitle || t('Subscription'),
                      })
                    : t('Freeze {{plan}}', {
                        plan: planTitle || t('Subscription'),
                      })
                }
                aria-busy={freezePending}
                onClick={() => onFreeze(id, !isFrozen)}
              >
                {isFrozen ? (
                  <Play className='size-3.5' aria-hidden='true' />
                ) : (
                  <Snowflake className='size-3.5' aria-hidden='true' />
                )}
                <span className='min-w-0 break-words'>
                  {isFrozen
                    ? t('Resume subscription')
                    : t('Freeze subscription')}
                </span>
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

interface MySubscriptionsCardProps {
  refreshSignal?: number
  embedded?: boolean
}

export function MySubscriptionsCard({
  refreshSignal,
  embedded = false,
}: MySubscriptionsCardProps = {}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const [allSubscriptions, setAllSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [activeSubscriptions, setActiveSubscriptions] = useState<
    UserSubscriptionRecord[]
  >([])
  const [activeOrder, setActiveOrder] = useState<number[]>([])
  const [plans, setPlans] = useState<PlanRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [billingPreference, setBillingPreference] =
    useState<BillingPreference>('subscription_first')
  const preferenceId = useId()
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  const [freezeCards, setFreezeCards] = useState(0)
  const [confirmFreezeId, setConfirmFreezeId] = useState<number | null>(null)
  const [freezePolicy, setFreezePolicy] = useState<SubscriptionFreezePolicy>()

  useEffect(() => {
    const id = window.setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      60_000
    )
    return () => window.clearInterval(id)
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const fetchData = useCallback(async () => {
    const [subRes, planRes] = await Promise.all([
      getSelfSubscriptionFull(),
      getPublicPlans(),
    ])
    requireServerSuccess(subRes)
    requireServerSuccess(planRes)
    if (subRes.data) {
      const active = subRes.data.subscriptions || []
      const all = subRes.data.all_subscriptions || []
      const order = [...active]
        .sort((a, b) => {
          const pa = a.subscription.user_priority ?? 0
          const pb = b.subscription.user_priority ?? 0
          if (pb !== pa) return pb - pa
          const endDifference =
            a.subscription.end_time - b.subscription.end_time
          return endDifference || a.subscription.id - b.subscription.id
        })
        .map((item) => item.subscription.id)
      setBillingPreference(
        ['wallet_first', 'wallet_only'].includes(subRes.data.billing_preference)
          ? 'wallet_first'
          : 'subscription_first'
      )
      setActiveSubscriptions(active)
      setAllSubscriptions(all)
      setFreezePolicy(subRes.data.freeze_policy)
      setFreezeCards(subRes.data.freeze_cards ?? 0)
      setActiveOrder(order)
    }
    if (planRes.success) setPlans(planRes.data || [])
  }, [])

  const freezeMutation = useMutation({
    mutationFn: async (input: {
      id: number
      frozen: boolean
      useFreezeCard?: boolean
    }) => {
      const response = await setSubscriptionFrozen(
        input.id,
        input.frozen,
        input.useFreezeCard
      )
      requireServerSuccess(response)
      return { input, subscription: response.data }
    },
    retry: false,
    onSuccess: async (result) => {
      setConfirmFreezeId(null)
      if (result.subscription) {
        const subscription = result.subscription
        setAllSubscriptions((records) =>
          records.map((record) =>
            record.subscription.id === subscription.id
              ? { ...record, subscription }
              : record
          )
        )
        setActiveSubscriptions((records) => {
          const updated = records.filter(
            (record) => record.subscription.id !== subscription.id
          )
          if (subscription.status === 'active') updated.push({ subscription })
          return updated
        })
        setActiveOrder((order) =>
          subscription.status === 'active'
            ? [...new Set([...order, subscription.id])]
            : order.filter((id) => id !== subscription.id)
        )
      }
      toast.success(
        result.input.frozen
          ? t('Subscription frozen')
          : t('Subscription resumed')
      )
      try {
        await fetchData()
      } catch (error) {
        handleServerError(error)
      }
    },
    onError: (error) => handleServerError(error),
  })

  const preferenceMutation = useMutation({
    mutationFn: async (preference: BillingPreference) => {
      const response = await updateBillingPreference(preference)
      requireServerSuccess(response)
      return response.data?.billing_preference ?? preference
    },
    retry: false,
    onSuccess: (preference) => {
      setBillingPreference(preference)
      toast.success(t('Billing preference updated'))
    },
    onError: (error) => handleServerError(error),
  })

  const priorityMutation = useMutation({
    mutationFn: async (input: { order: number[]; previousOrder: number[] }) => {
      const response = await updateSubscriptionPriorities(
        input.order.map((id, index) => ({
          id,
          priority: input.order.length - index,
        }))
      )
      requireServerSuccess(response)
    },
    retry: false,
    onSuccess: (_, input) => {
      setActiveSubscriptions((records) =>
        records.map((record) => ({
          ...record,
          subscription: {
            ...record.subscription,
            user_priority:
              input.order.length - input.order.indexOf(record.subscription.id),
          },
        }))
      )
      toast.success(t('Priority updated'))
    },
    onError: (error, input) => {
      setActiveOrder(input.previousOrder)
      handleServerError(error)
    },
  })
  const saving = priorityMutation.isPending || preferenceMutation.isPending
  const busy = saving || refreshing || freezeMutation.isPending

  const handleFreeze = (id: number, frozen: boolean) => {
    if (busy) return
    if (frozen && freezePolicy?.allowed !== true) {
      setConfirmFreezeId(id)
      return
    }
    freezeMutation.mutate({ id, frozen })
  }

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      try {
        await fetchData()
      } catch (error) {
        handleServerError(error)
      } finally {
        setLoading(false)
      }
    }
    void init()
  }, [fetchData])

  useEffect(() => {
    if (
      refreshSignal === undefined ||
      refreshSignal === 0 ||
      saving ||
      freezeMutation.isPending
    ) {
      return
    }
    void fetchData().catch(handleServerError)
  }, [refreshSignal, fetchData, saving, freezeMutation.isPending])

  const planTitleMap = useMemo(() => {
    return new Map(plans.map((item) => [item.plan.id, item.plan.title]))
  }, [plans])

  const orderedActive = useMemo(() => {
    const map = new Map(
      activeSubscriptions.map((item) => [item.subscription.id, item])
    )
    return activeOrder
      .map((id) => map.get(id))
      .filter(Boolean) as UserSubscriptionRecord[]
  }, [activeOrder, activeSubscriptions])

  const inactive = useMemo(() => {
    const activeIds = new Set(
      activeSubscriptions.map((item) => item.subscription.id)
    )
    return allSubscriptions.filter(
      (item) =>
        !activeIds.has(item.subscription.id) &&
        item.subscription.status !== 'frozen'
    )
  }, [activeSubscriptions, allSubscriptions])

  const frozenSubscriptions = allSubscriptions.filter(
    (item) => item.subscription.status === 'frozen'
  )

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchData()
    } catch (error) {
      handleServerError(error)
    } finally {
      setRefreshing(false)
    }
  }

  const saveOrder = (order: number[]) => {
    if (busy || order.every((id, index) => id === activeOrder[index])) return
    const previousOrder = activeOrder
    setActiveOrder(order)
    priorityMutation.mutate({ order, previousOrder })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = activeOrder.indexOf(Number(active.id))
    const newIndex = activeOrder.indexOf(Number(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    saveOrder(arrayMove(activeOrder, oldIndex, newIndex))
  }

  const activeCount = activeSubscriptions.length
  const inactiveCount = inactive.length
  const draggable = activeOrder.length > 1

  if (loading) {
    return (
      <TitledCard
        title={t('My Subscriptions')}
        icon={<Layers className='h-4 w-4' aria-hidden='true' />}
      >
        <Skeleton className='h-20 w-full' />
      </TitledCard>
    )
  }

  const firstSubscription = orderedActive[0]

  return (
    <section aria-label={t('My Subscriptions')} className='min-w-0'>
      <TitledCard
        title={embedded ? null : <h3>{t('My Subscriptions')}</h3>}
        className={
          embedded
            ? 'rounded-none border-0 bg-transparent shadow-none ring-0'
            : 'rounded-xl'
        }
        titleClassName='text-sm font-semibold sm:text-sm'
        disableHoverEffect
        headerClassName={cn(
          'border-b-0 px-4 pt-4 !pb-3 sm:px-5 sm:pt-4 sm:!pb-3',
          embedded &&
            'px-0 pt-0 sm:px-0 sm:pt-0 [&>div]:flex-row [&>div]:flex-wrap [&>div>div:first-child]:hidden [&>div>div:last-child]:w-full',
          !draggable &&
            inactiveCount === 0 &&
            '[&>div]:flex-row [&>div]:items-center [&>div]:justify-between [&>div>div:last-child]:w-auto'
        )}
        contentClassName={
          embedded ? 'p-0 sm:p-0' : 'px-4 pt-0 pb-4 sm:px-5 sm:pt-0 sm:pb-5'
        }
        action={
          <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1'>
            <span className='text-muted-foreground text-xs'>
              {t('Freeze cards: {{count}}', {
                count: formatNumber(freezeCards, locale),
              })}
            </span>
            {(activeCount > 0 || frozenSubscriptions.length === 0) && (
              <StatusBadge
                copyable={false}
                type='text'
                className='text-xs font-normal whitespace-nowrap'
                variant={activeCount > 0 ? 'success' : 'neutral'}
                label={
                  activeCount > 0
                    ? t('{{activeCount}} active', {
                        activeCount: formatNumber(activeCount, locale),
                      })
                    : t('No Active')
                }
              />
            )}
            {frozenSubscriptions.length > 0 && (
              <StatusBadge
                copyable={false}
                type='text'
                className='text-xs font-normal whitespace-nowrap'
                variant='info'
                label={t('{{count}} frozen', {
                  count: frozenSubscriptions.length,
                })}
              />
            )}

            {inactiveCount > 0 && (
              <Button
                variant='ghost'
                className='h-9'
                onClick={() => setHistoryDialogOpen(true)}
              >
                <History className='size-4' aria-hidden='true' />
                {t('Subscription History')} ({inactiveCount})
              </Button>
            )}
            <Button
              variant='ghost'
              size='icon'
              className='size-9'
              aria-label={t('Refresh')}
              onClick={handleRefresh}
              disabled={busy}
            >
              <RefreshCw
                className={cn('size-4', refreshing && 'animate-spin')}
                aria-hidden='true'
              />
            </Button>
          </div>
        }
      >
        <div className='mb-4 space-y-2'>
          <p id={preferenceId} className='text-sm font-medium'>
            {t('Billing preference')}
          </p>
          <RadioGroup
            aria-labelledby={preferenceId}
            value={billingPreference}
            disabled={busy}
            onValueChange={(value) => {
              if (
                !busy &&
                (value === 'subscription_first' || value === 'wallet_first') &&
                value !== billingPreference
              ) {
                preferenceMutation.mutate(value)
              }
            }}
            className='flex flex-wrap gap-x-6 gap-y-3'
          >
            <Label className='flex min-h-9 items-center gap-2'>
              <RadioGroupItem value='subscription_first' />
              {t('Subscription first')}
            </Label>
            <Label className='flex min-h-9 items-center gap-2'>
              <RadioGroupItem value='wallet_first' />
              {t('Wallet first')}
            </Label>
          </RadioGroup>
          <p className='text-muted-foreground text-xs leading-relaxed'>
            {billingPreference === 'wallet_first'
              ? t(
                  'Use wallet balance first, then eligible subscriptions if the balance is insufficient.'
                )
              : t(
                  'Use eligible subscriptions first, then wallet balance if no subscription can cover the request.'
                )}
          </p>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={activeOrder}
            strategy={verticalListSortingStrategy}
          >
            {draggable && (
              <p className='text-muted-foreground mb-3 text-xs leading-relaxed'>
                {t(
                  'Drag or use the arrows to change the order. Eligible subscriptions are tried from top to bottom.'
                )}
              </p>
            )}
            <div
              role='list'
              aria-label={t('Subscription deduction order')}
              className='space-y-2'
            >
              {orderedActive.map((record, index) => (
                <SubscriptionRow
                  key={record.subscription.id}
                  record={record}
                  planTitle={
                    record.plan_title ||
                    planTitleMap.get(record.subscription.plan_id) ||
                    ''
                  }
                  draggable={draggable}
                  order={index + 1}
                  onMove={(offset) =>
                    saveOrder(arrayMove(activeOrder, index, index + offset))
                  }
                  moveUpDisabled={busy || index === 0}
                  moveDownDisabled={busy || index === activeOrder.length - 1}
                  nowSec={nowSec}
                  freezeAllowed={
                    freezePolicy?.allowed === true || freezeCards > 0
                  }
                  freezePending={busy}
                  onFreeze={handleFreeze}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        {frozenSubscriptions.length > 0 && (
          <div
            role='list'
            className={cn('space-y-2', firstSubscription && 'mt-3')}
          >
            {frozenSubscriptions.map((record) => (
              <SubscriptionRow
                key={record.subscription.id}
                record={record}
                planTitle={
                  record.plan_title ||
                  planTitleMap.get(record.subscription.plan_id) ||
                  ''
                }
                draggable={false}
                nowSec={nowSec}
                freezeAllowed={false}
                freezePending={busy}
                onFreeze={handleFreeze}
              />
            ))}
          </div>
        )}
        {!firstSubscription && frozenSubscriptions.length === 0 && (
          <p className='text-muted-foreground py-3 text-center text-sm'>
            {allSubscriptions.length > 0
              ? t('No Active')
              : t('No subscription records')}
          </p>
        )}
        {(firstSubscription || frozenSubscriptions.length > 0) && (
          <p className='text-muted-foreground mt-3 text-xs leading-relaxed'>
            {t(
              'Freezing is free on mainland China public holidays (Beijing time); otherwise it costs 1 freeze card. Resume anytime; validity and quota reset dates shift by the frozen duration.'
            )}
            {freezePolicy && !freezePolicy.calendar_available && (
              <span className='mt-1 block'>
                {t(
                  'The holiday calendar is unavailable. Freezing requires 1 freeze card; resuming remains free.'
                )}
              </span>
            )}
          </p>
        )}
      </TitledCard>
      <ConfirmDialog
        open={confirmFreezeId !== null}
        onOpenChange={(open) => {
          if (!open && !freezeMutation.isPending) setConfirmFreezeId(null)
        }}
        title={t('Use a freeze card?')}
        desc={t(
          'Freezing this subscription will use 1 freeze card. You have {{count}} remaining. The card will not be returned when you resume.',
          { count: formatNumber(freezeCards, locale) }
        )}
        confirmText={t('Use 1 card and freeze')}
        isLoading={freezeMutation.isPending}
        disabled={busy || freezeCards <= 0}
        handleConfirm={() => {
          if (!busy && confirmFreezeId !== null) {
            freezeMutation.mutate({
              id: confirmFreezeId,
              frozen: true,
              useFreezeCard: true,
            })
          }
        }}
      />
      <SubscriptionHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
      />
    </section>
  )
}
