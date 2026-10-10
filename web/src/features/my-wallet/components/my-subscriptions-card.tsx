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
  ChevronDown,
  CreditCard,
  GripVertical,
  History,
  Layers,
  RefreshCw,
  Snowflake,
  Play,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StatusBadge } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { TitledCard } from '@/components/ui/titled-card'
import {
  getPublicPlans,
  getSelfSubscriptionFull,
  updateSubscriptionPriorities,
  setSubscriptionFrozen,
} from '@/features/subscriptions/api'
import type {
  PlanRecord,
  UserSubscriptionRecord,
  SubscriptionFreezePolicy,
} from '@/features/subscriptions/types'
import { formatQuota } from '@/lib/format'
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
}: {
  record: UserSubscriptionRecord
  planTitle: string
  draggable: boolean
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
  } = useSortable({ id, disabled: !draggable })
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
      <div className='flex items-stretch'>
        {draggable ? (
          <Button
            type='button'
            variant='ghost'
            className='text-muted-foreground h-auto w-11 shrink-0 cursor-grab touch-none self-stretch rounded-r-none active:cursor-grabbing'
            aria-label={t('Drag to reorder')}
            {...attributes}
            {...listeners}
          >
            <GripVertical className='size-4' />
          </Button>
        ) : null}

        <div className='grid min-w-0 flex-1 items-center gap-3 p-3 sm:p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] md:gap-6'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <div className='min-w-0 flex-1'>
                <span className='text-sm font-semibold break-words'>
                  {planTitle || t('Subscription')}
                </span>
              </div>
              <StatusBadge
                label={statusLabel}
                variant={statusVariant}
                copyable={false}
              />
            </div>

            <div className='mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
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
            <div className='min-w-0'>
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
          {isActive || isFrozen ? (
            <div className='flex justify-end'>
              <Button
                type='button'
                variant='outline'
                size='sm'
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
                {isFrozen ? t('Resume subscription') : t('Freeze subscription')}
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
}

export function MySubscriptionsCard({
  refreshSignal,
}: MySubscriptionsCardProps = {}) {
  const { t } = useTranslation()
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
  const [saving, setSaving] = useState(false)
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))
  const [freezePolicy, setFreezePolicy] = useState<SubscriptionFreezePolicy>()
  const initialOrderRef = useRef<number[]>([])

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
    if (subRes.success && subRes.data) {
      const active = subRes.data.subscriptions || []
      const all = subRes.data.all_subscriptions || []
      const order = [...active]
        .sort((a, b) => {
          const pa = a.subscription.user_priority ?? 0
          const pb = b.subscription.user_priority ?? 0
          if (pb !== pa) return pb - pa
          return a.subscription.id - b.subscription.id
        })
        .map((item) => item.subscription.id)
      setActiveSubscriptions(active)
      setAllSubscriptions(all)
      setFreezePolicy(subRes.data.freeze_policy)
      setActiveOrder(order)
      initialOrderRef.current = order
    }
    if (planRes.success) setPlans(planRes.data || [])
  }, [])

  const freezeMutation = useMutation({
    mutationFn: async (input: { id: number; frozen: boolean }) => {
      const response = await setSubscriptionFrozen(input.id, input.frozen)
      requireServerSuccess(response)
      return { input, subscription: response.data }
    },
    retry: false,
    onSuccess: async (result) => {
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

  const handleFreeze = (id: number, frozen: boolean) => {
    if (freezeMutation.isPending) return
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
    if (refreshSignal === undefined || refreshSignal === 0) return
    void fetchData().catch(handleServerError)
  }, [refreshSignal, fetchData])

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setActiveOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as number)
      const newIndex = prev.indexOf(over.id as number)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  useEffect(() => {
    if (loading || freezeMutation.isPending || activeOrder.length === 0) return
    const unchanged =
      activeOrder.length === initialOrderRef.current.length &&
      activeOrder.every((id, index) => id === initialOrderRef.current[index])
    if (unchanged) return

    const items = activeOrder.map((id, index) => ({
      id,
      priority: activeOrder.length - index,
    }))
    setSaving(true)
    updateSubscriptionPriorities(items)
      .then((res) => {
        if (res.success) {
          initialOrderRef.current = activeOrder
          toast.success(t('Priority updated'))
        } else {
          toast.error(res.message || t('Update failed'))
        }
      })
      .finally(() => setSaving(false))
      .catch(() => toast.error(t('Request failed')))
  }, [activeOrder, loading, freezeMutation.isPending, t])

  const activeCount = activeSubscriptions.length
  const inactiveCount = inactive.length
  const draggable = activeOrder.length > 1
  const showAllSubscriptions = expanded && draggable

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
    <section aria-label={t('My Subscriptions')}>
      <Collapsible open={showAllSubscriptions} onOpenChange={setExpanded}>
        <TitledCard
          title={
            <span className='flex flex-wrap items-center gap-2'>
              {t('My Subscriptions')}
              {(activeCount > 0 || frozenSubscriptions.length === 0) && (
                <StatusBadge
                  copyable={false}
                  variant={activeCount > 0 ? 'success' : 'neutral'}
                  label={
                    activeCount > 0
                      ? `${activeCount} ${t('active')}`
                      : t('No Active')
                  }
                />
              )}
              {frozenSubscriptions.length > 0 && (
                <StatusBadge
                  copyable={false}
                  variant='info'
                  label={t('{{count}} frozen', {
                    count: frozenSubscriptions.length,
                  })}
                />
              )}
            </span>
          }
          description={t('Matching subscriptions first, then wallet balance')}
          icon={<Layers className='h-4 w-4' aria-hidden='true' />}
          disableHoverEffect
          headerClassName={cn(
            'border-b-0 !pb-3 sm:!pb-3',
            !draggable &&
              inactiveCount === 0 &&
              '[&>div]:flex-row [&>div>div:last-child]:w-auto'
          )}
          contentClassName='pt-0 sm:pt-0'
          action={
            <div className='flex flex-wrap items-center gap-1'>
              {draggable && (
                <CollapsibleTrigger
                  render={<Button variant='outline' className='h-9 gap-2' />}
                >
                  {showAllSubscriptions
                    ? t('Collapse')
                    : t('Manage subscriptions')}
                  <ChevronDown
                    className={cn(
                      'size-4',
                      showAllSubscriptions && 'rotate-180'
                    )}
                    aria-hidden='true'
                  />
                </CollapsibleTrigger>
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
                disabled={refreshing || saving || freezeMutation.isPending}
              >
                <RefreshCw
                  className={cn('size-4', refreshing && 'animate-spin')}
                  aria-hidden='true'
                />
              </Button>
            </div>
          }
        >
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={activeOrder}
              strategy={verticalListSortingStrategy}
            >
              {!showAllSubscriptions && firstSubscription && (
                <SubscriptionRow
                  record={firstSubscription}
                  planTitle={
                    firstSubscription.plan_title ||
                    planTitleMap.get(firstSubscription.subscription.plan_id) ||
                    ''
                  }
                  draggable={false}
                  nowSec={nowSec}
                  freezeAllowed={freezePolicy?.allowed === true}
                  freezePending={freezeMutation.isPending}
                  onFreeze={handleFreeze}
                />
              )}
              <CollapsibleContent>
                <p className='text-muted-foreground mb-3 text-xs'>
                  {t('Drag subscriptions to set deduction order')}
                </p>
                <div className='space-y-2'>
                  {showAllSubscriptions &&
                    orderedActive.map((record) => (
                      <SubscriptionRow
                        key={record.subscription.id}
                        record={record}
                        planTitle={
                          record.plan_title ||
                          planTitleMap.get(record.subscription.plan_id) ||
                          ''
                        }
                        draggable={
                          draggable && !freezeMutation.isPending && !saving
                        }
                        nowSec={nowSec}
                        freezeAllowed={freezePolicy?.allowed === true}
                        freezePending={freezeMutation.isPending}
                        onFreeze={handleFreeze}
                      />
                    ))}
                </div>
              </CollapsibleContent>
            </SortableContext>
          </DndContext>
          {frozenSubscriptions.length > 0 && (
            <div className={cn('space-y-2', firstSubscription && 'mt-3')}>
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
                  freezePending={freezeMutation.isPending}
                  onFreeze={handleFreeze}
                />
              ))}
            </div>
          )}
          {!firstSubscription && frozenSubscriptions.length === 0 && (
            <p className='text-muted-foreground bg-muted/30 rounded-lg px-4 py-3 text-sm'>
              {allSubscriptions.length > 0
                ? t('No Active')
                : t('No subscription records')}
            </p>
          )}
          {(firstSubscription || frozenSubscriptions.length > 0) && (
            <p className='text-muted-foreground mt-3 text-xs leading-relaxed'>
              {t(
                'Freeze on mainland China public holidays (including adjusted days off), based on Beijing time. Resume anytime; validity and quota reset dates shift by the frozen duration.'
              )}
              {freezePolicy && !freezePolicy.calendar_available && (
                <span className='mt-1 block'>
                  {t(
                    'The holiday calendar is unavailable. Freezing is temporarily disabled; frozen subscriptions can still be resumed.'
                  )}
                </span>
              )}
            </p>
          )}
        </TitledCard>
      </Collapsible>
      <SubscriptionHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
      />
    </section>
  )
}
