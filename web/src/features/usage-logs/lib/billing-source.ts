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
import type {
  PlanRecord,
  UserSubscriptionRecord,
} from '@/features/subscriptions/types'

import type { LogOtherData } from '../types'

interface BillingSourceVisibilityInput {
  isAdmin: boolean
  /** Admin view only: every system plan. */
  plans: PlanRecord[] | undefined
  /** Own-logs view only: active subscriptions returned by the self API. */
  subscriptions: UserSubscriptionRecord[] | undefined
}

/**
 * Every consume log carries `billing_source`, so the Wallet / Subscription
 * icon on the cost column is only a disambiguator. Admins see it when the
 * system has an enabled plan; own-logs views require an active subscription.
 */
export function shouldShowBillingSource(
  input: BillingSourceVisibilityInput
): boolean {
  if (input.isAdmin) {
    return (input.plans ?? []).some((record) => record.plan?.enabled === true)
  }
  return (input.subscriptions?.length ?? 0) > 0
}

/** Use the rate recorded for this request; never infer it from today's plan or model. */
export function getBillingRatio(other: LogOtherData | null): {
  value: number | undefined
  labelKey: 'Billing multiplier' | 'User Exclusive Ratio' | 'Group Ratio'
  restricted: boolean
} {
  const recorded = other?.billing_group_ratio
  const restricted =
    other?.billing_source === 'subscription' &&
    other.billing_ratio_source === 'subscription_unit'
  if (recorded != null && Number.isFinite(recorded) && recorded >= 0) {
    return { value: recorded, labelKey: 'Billing multiplier', restricted }
  }
  const userRatio = other?.user_group_ratio
  if (userRatio != null && Number.isFinite(userRatio) && userRatio >= 0) {
    return {
      value: userRatio,
      labelKey: 'User Exclusive Ratio',
      restricted: false,
    }
  }
  const groupRatio = other?.group_ratio
  const value =
    groupRatio != null && Number.isFinite(groupRatio) && groupRatio >= 0
      ? groupRatio
      : undefined
  return { value, labelKey: 'Group Ratio', restricted: false }
}
