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
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  ChevronDown,
  CreditCard,
  Layers,
  Loader2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatQuota, formatCompactNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { StatusBadge } from '@/components/status-badge'
import { getUserSubscriptions } from '@/features/subscriptions/api'
import type { UserSubscriptionRecord } from '@/features/subscriptions/types'
import { getUserInfo } from '../../api'
import type { UserInfo } from '../../types'

interface UserInfoDialogProps {
  userId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function SubscriptionCard({
  record,
  nowSec,
}: {
  record: UserSubscriptionRecord
  nowSec: number
}) {
  const { t } = useTranslation()
  const sub = record.subscription
  const isExpired = (sub.end_time || 0) > 0 && sub.end_time < nowSec
  const isCancelled = sub.status === 'cancelled'
  const isActive = sub.status === 'active' && !isExpired
  const total = Number(sub.amount_total || 0)
  const used = Number(sub.amount_used || 0)
  const remaining = total > 0 ? Math.max(0, total - used) : 0
  const usagePercent =
    total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const planTitle = record.plan_title || `#${sub.plan_id}`

  return (
    <div
      className={cn(
        'bg-background rounded-lg border px-3 py-2.5',
        !isActive && 'border-dashed opacity-70'
      )}
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='truncate text-sm font-semibold'>{planTitle}</span>
        {isActive ? (
          <StatusBadge
            label={t('Active')}
            variant='success'
            copyable={false}
          />
        ) : isCancelled ? (
          <StatusBadge
            label={t('Cancelled')}
            variant='neutral'
            copyable={false}
          />
        ) : (
          <StatusBadge
            label={t('Expired')}
            variant='neutral'
            copyable={false}
          />
        )}
      </div>

      {sub.end_time > 0 && (
        <div className='text-muted-foreground mt-1.5 inline-flex items-center gap-1 text-[11px]'>
          <CalendarClock className='size-3' />
          {isActive
            ? t('Until')
            : isCancelled
              ? t('Cancelled at')
              : t('Expired at')}{' '}
          <span className='text-foreground/80'>
            {new Date(sub.end_time * 1000).toLocaleDateString()}
          </span>
        </div>
      )}

      {total > 0 ? (
        <div className='mt-2'>
          <div className='text-muted-foreground/80 mb-1 flex items-center justify-between text-[11px]'>
            <span className='inline-flex items-center gap-1'>
              <CreditCard className='size-3' />
              {formatQuota(used)} / {formatQuota(total)}
            </span>
            <span className='tabular-nums'>{usagePercent}%</span>
          </div>
          <Progress value={usagePercent} className='h-1.5' />
          <div className='text-muted-foreground/70 mt-1 text-[11px]'>
            {t('Remaining')} {formatQuota(remaining)}
          </div>
        </div>
      ) : (
        <div className='text-muted-foreground/70 mt-2 inline-flex items-center gap-1 text-xs'>
          <Layers className='size-3' />
          {t('Unlimited')}
        </div>
      )}
    </div>
  )
}

export function UserInfoDialog({
  userId,
  open,
  onOpenChange,
}: UserInfoDialogProps) {
  const { t } = useTranslation()
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [subscriptions, setSubscriptions] = useState<UserSubscriptionRecord[]>(
    []
  )
  const [isLoading, setIsLoading] = useState(false)
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000))

  useEffect(() => {
    if (!open) return
    setNowSec(Math.floor(Date.now() / 1000))
    const id = window.setInterval(
      () => setNowSec(Math.floor(Date.now() / 1000)),
      60_000
    )
    return () => window.clearInterval(id)
  }, [open])

  const fetchAll = useCallback(
    async (id: number) => {
      setIsLoading(true)
      try {
        const [userRes, subsRes] = await Promise.all([
          getUserInfo(id),
          getUserSubscriptions(id),
        ])
        if (userRes.success) {
          setUserInfo(userRes.data || null)
        } else {
          toast.error(userRes.message || t('Failed to fetch user information'))
        }
        if (subsRes.success) {
          setSubscriptions(subsRes.data || [])
        } else {
          setSubscriptions([])
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch user info:', error)
        toast.error(t('Failed to fetch user information'))
      } finally {
        setIsLoading(false)
      }
    },
    [t]
  )

  useEffect(() => {
    if (open && userId) {
      setUserInfo(null)
      setSubscriptions([])
      fetchAll(userId)
    }
  }, [open, userId, fetchAll])

  const { active, inactive } = useMemo(() => {
    const a: UserSubscriptionRecord[] = []
    const i: UserSubscriptionRecord[] = []
    for (const record of subscriptions) {
      const sub = record.subscription
      const isExpired = (sub.end_time || 0) > 0 && sub.end_time < nowSec
      const isActive = sub.status === 'active' && !isExpired
      if (isActive) a.push(record)
      else i.push(record)
    }
    a.sort((x, y) => {
      const pa = x.subscription.user_priority ?? 0
      const pb = y.subscription.user_priority ?? 0
      if (pb !== pa) return pb - pa
      return x.subscription.id - y.subscription.id
    })
    i.sort((x, y) => {
      const ea = x.subscription.end_time || 0
      const eb = y.subscription.end_time || 0
      if (eb !== ea) return eb - ea
      return y.subscription.id - x.subscription.id
    })
    return { active: a, inactive: i }
  }, [subscriptions, nowSec])

  const InfoItem = ({
    label,
    value,
  }: {
    label: string
    value: string | number
  }) => (
    <div className='space-y-1.5'>
      <Label className='text-muted-foreground text-xs'>{label}</Label>
      <div className='text-sm font-semibold'>{value}</div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[85vh] flex-col sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('User Information')}</DialogTitle>
          <DialogDescription>
            {t(
              'View detailed information about this user including balance, usage statistics, and invitation details.'
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className='flex items-center justify-center py-8'>
            <Loader2 className='text-muted-foreground size-6 animate-spin' />
          </div>
        ) : userInfo ? (
          <div className='-mr-2 min-h-0 flex-1 space-y-4 overflow-y-auto py-1 pr-2'>
            {/* Basic Info */}
            <div className='grid grid-cols-2 gap-4'>
              <InfoItem label={t('Username')} value={userInfo.username} />
              {userInfo.display_name && (
                <InfoItem
                  label={t('Display Name')}
                  value={userInfo.display_name}
                />
              )}
            </div>

            {/* Balance Info */}
            <div className='grid grid-cols-2 gap-4'>
              <InfoItem
                label={t('Balance')}
                value={formatQuota(userInfo.quota)}
              />
              <InfoItem
                label={t('Used Quota')}
                value={formatQuota(userInfo.used_quota)}
              />
            </div>

            {/* Statistics */}
            <div className='grid grid-cols-2 gap-4'>
              <InfoItem
                label={t('Request Count')}
                value={formatCompactNumber(userInfo.request_count)}
              />
              {userInfo.group && (
                <InfoItem label={t('User Group')} value={userInfo.group} />
              )}
            </div>

            {/* Invitation Info */}
            {(userInfo.aff_code ||
              userInfo.aff_count !== undefined ||
              (userInfo.aff_quota !== undefined && userInfo.aff_quota > 0)) && (
              <>
                <div className='grid grid-cols-2 gap-4'>
                  {userInfo.aff_code && (
                    <InfoItem
                      label={t('Invitation Code')}
                      value={userInfo.aff_code}
                    />
                  )}
                  {userInfo.aff_count !== undefined && (
                    <InfoItem
                      label={t('Invited Users')}
                      value={formatCompactNumber(userInfo.aff_count)}
                    />
                  )}
                </div>

                {userInfo.aff_quota !== undefined && userInfo.aff_quota > 0 && (
                  <InfoItem
                    label={t('Invitation Quota')}
                    value={formatQuota(userInfo.aff_quota)}
                  />
                )}
              </>
            )}

            {/* Remark */}
            {userInfo.remark && (
              <div className='space-y-1.5'>
                <Label className='text-muted-foreground text-xs'>
                  {t('Remark')}
                </Label>
                <div className='text-sm leading-relaxed font-semibold break-words'>
                  {userInfo.remark}
                </div>
              </div>
            )}

            {/* Subscriptions */}
            {subscriptions.length > 0 && (
              <div className='space-y-2'>
                <div className='flex items-center gap-2'>
                  <Layers className='text-muted-foreground size-4' />
                  <Label className='text-muted-foreground text-xs'>
                    {t('Subscriptions')}
                  </Label>
                  {active.length > 0 && (
                    <StatusBadge
                      copyable={false}
                      variant='success'
                      label={`${active.length} ${t('active')}`}
                    />
                  )}
                  {inactive.length > 0 && (
                    <span className='text-muted-foreground text-[11px]'>
                      · {inactive.length} {t('expired')}
                    </span>
                  )}
                </div>

                <div className='space-y-2'>
                  {active.map((record) => (
                    <SubscriptionCard
                      key={record.subscription.id}
                      record={record}
                      nowSec={nowSec}
                    />
                  ))}
                </div>

                {inactive.length > 0 && (
                  <Collapsible key={userId ?? 'none'}>
                    <CollapsibleTrigger className='hover:bg-muted/50 group flex w-full cursor-pointer items-center justify-between rounded-md border border-dashed px-3 py-1.5 text-xs'>
                      <span className='text-muted-foreground'>
                        {t('Show expired subscriptions')} ({inactive.length})
                      </span>
                      <ChevronDown className='text-muted-foreground size-3.5 transition-transform group-data-[panel-open]:rotate-180' />
                    </CollapsibleTrigger>
                    <CollapsibleContent className='mt-2 space-y-2'>
                      {inactive.map((record) => (
                        <SubscriptionCard
                          key={record.subscription.id}
                          record={record}
                          nowSec={nowSec}
                        />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className='text-muted-foreground py-8 text-center text-sm'>
            {t('No user information available')}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
