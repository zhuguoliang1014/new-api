import type { TFunction } from 'i18next'
import { Receipt, ScrollText, Wallet } from 'lucide-react'

import { IconWeChat } from '@/assets/brand-icons'
import type { NavItem, SidebarData } from '@/components/layout/types'
import { LOCAL_CONFIG } from '@/lib/local-config'

// Local-only sidebar entries. Kept in a sibling hook so future merges only
// have to keep the single injectLocalNavItems() call in use-sidebar-data.ts.

function getLocalPersonalItems(t: TFunction): NavItem[] {
  return [
    {
      title: t('Wallet'),
      url: LOCAL_CONFIG.walletRoute,
      icon: Wallet,
    },
    {
      title: '我的订单',
      url: '/orders',
      icon: Receipt,
    },
  ]
}

function getLocalAdminItems(t: TFunction): NavItem[] {
  return [
    {
      title: t('Order History'),
      url: '/all-orders',
      icon: ScrollText,
    },
  ]
}

function getLocalCommunityItems(t: TFunction): NavItem[] {
  return [
    {
      title: t('WeChat Community'),
      url: '/wechat',
      icon: IconWeChat,
    },
  ]
}

// Inserts local items into the matching upstream group; falls back to
// appending a new group if the upstream group is missing.
function injectInto(
  base: SidebarData,
  groupId: string,
  items: NavItem[],
  insertIndex: number
): SidebarData {
  return {
    ...base,
    navGroups: base.navGroups.map((g) => {
      if (g.id !== groupId) return g
      const next = [...g.items]
      next.splice(insertIndex, 0, ...items)
      return { ...g, items: next }
    }),
  }
}

export function injectLocalNavItems(
  base: SidebarData,
  t: TFunction
): SidebarData {
  // Personal: prepend Wallet/Orders and place the community link after Profile.
  const personalItems = getLocalPersonalItems(t)
  let next = injectInto(base, 'personal', personalItems, 0)
  next = injectInto(
    next,
    'personal',
    getLocalCommunityItems(t),
    personalItems.length + 1
  )
  // Admin: insert Order History after Channels (index 1).
  next = injectInto(next, 'admin', getLocalAdminItems(t), 1)
  return next
}
