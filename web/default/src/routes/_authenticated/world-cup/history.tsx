import { createFileRoute } from '@tanstack/react-router'
import { WorldCupHistoryPage } from '@/features/world-cup'

export const Route = createFileRoute('/_authenticated/world-cup/history')({
  component: WorldCupHistoryPage,
})
