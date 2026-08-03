import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { MyWallet } from '@/features/my-wallet'

const myWalletSearchSchema = z.object({
  tab: z.enum(['recharge', 'subscription', 'affiliate']).optional(),
})

export const Route = createFileRoute('/_authenticated/my-wallet/')({
  component: RouteComponent,
  validateSearch: myWalletSearchSchema,
})

function RouteComponent() {
  const { tab } = Route.useSearch()
  return <MyWallet initialTab={tab} />
}
