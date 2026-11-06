import type { TFunction } from 'i18next'
import { Megaphone, Receipt, ScrollText, Wallet } from 'lucide-react'

import type {
  NavItem,
  SidebarData,
  SidebarBadges,
} from '@/components/layout/types'
import { LOCAL_CONFIG } from '@/lib/local-config'
import { ROLE } from '@/lib/roles'

// Local-only sidebar entries. Kept in a sibling hook so future merges only
// have to keep the single injectLocalNavItems() call in use-sidebar-data.ts.

function getLocalPersonalItems(t: TFunction, badges: SidebarBadges): NavItem[] {
  return [
    {
      title: t('Wallet'),
      url: LOCAL_CONFIG.walletRoute,
      icon: Wallet,
      badge: badges.walletSavings,
      badgeVariant: 'destructive',
      badgeAnimated: true,
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
  t: TFunction,
  badges: SidebarBadges = {}
): SidebarData {
  // Personal: prepend Wallet/Orders.
  const personalItems = getLocalPersonalItems(t, badges)
  let next = injectInto(base, 'personal', personalItems, 0)
  // Admin: insert Order History after Channels (index 1).
  next = injectInto(next, 'admin', getLocalAdminItems(t), 1)
  next = injectInto(
    next,
    'admin',
    [
      {
        title: t('Telegram Announcements'),
        url: '/telegram-announcements',
        icon: Megaphone,
        requiredRole: ROLE.SUPER_ADMIN,
      },
    ],
    99
  )
  return next
}
