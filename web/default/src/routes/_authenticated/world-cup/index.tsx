import { createFileRoute } from '@tanstack/react-router'
import { WorldCup } from '@/features/world-cup'

export const Route = createFileRoute('/_authenticated/world-cup/')({
  component: WorldCup,
})
