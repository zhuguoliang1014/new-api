import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { expect, test } from 'vitest'

import { Form } from '@/components/ui/form'

import { PlanPromotionFields } from '../plan-promotion-fields'

function PromotionEditor() {
  const form = useForm({
    defaultValues: {
      minimum_effective_ratio: 0.18,
      discount_rate: 0.8,
      discount_starts_at: 0,
      discount_ends_at: Math.floor(Date.now() / 1000) + 3600,
      limited_sale: false,
    },
  })
  return (
    <Form {...form}>
      <form>
        <PlanPromotionFields quotaUSD={6000} priceCNY={1360} billingRatio={1} />
      </form>
    </Form>
  )
}

test.each([0.17, 0.18, 0.180001, 0.181333, 0.23])(
  'the alternate editor accepts decimal minimum %s without step mismatch',
  async (minimum) => {
    render(<PromotionEditor />)
    const user = userEvent.setup()
    const input = screen.getByRole('spinbutton', {
      name: 'Minimum effective multiplier',
    }) as HTMLInputElement
    await user.clear(input)
    await user.type(input, String(minimum))
    expect(input.validity.stepMismatch).toBe(false)
    expect(input.checkValidity()).toBe(true)
  }
)
