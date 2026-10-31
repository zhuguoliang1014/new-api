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
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { getPricing } from '@/features/pricing/api'
import { useBillingTime } from '@/features/pricing/hooks/use-billing-time'
import { useStatus } from '@/hooks/use-status'
import { toIntlLocale } from '@/i18n/languages'
import { formatCnyCurrencyAmount } from '@/lib/currency'
import { requireServerSuccess } from '@/lib/server-error-message'
import { useAuthStore } from '@/stores/auth-store'

import type { StudioGroup } from '../api'
import { estimateStudioCost } from '../lib/cost'
import { useImagePlaygroundStore } from '../store'

export function StudioCostEstimate(props: { group?: StudioGroup }) {
  const { t, i18n } = useTranslation()
  const scope = useAuthStore((state) => state.auth.session?.sid)
  const parameters = useImagePlaygroundStore((state) => state.parameters)
  const { status, loading: statusLoading, error: statusError } = useStatus()
  const pricing = useQuery({
    queryKey: ['image-playground', 'pricing', scope],
    queryFn: async () => requireServerSuccess(await getPricing()),
    enabled: Boolean(scope),
    staleTime: 60_000,
    retry: false,
    meta: { errorToast: false },
  })
  const model = pricing.data?.data.find(
    (item) =>
      item.model_name === parameters.model &&
      (item.enable_groups.includes(props.group?.id ?? '') ||
        item.enable_groups.includes('all'))
  )
  const now = useBillingTime(model?.billing_expr)
  const cost =
    pricing.isError || statusError
      ? null
      : estimateStudioCost(
          model,
          parameters,
          props.group?.ratio,
          typeof status?.price === 'number' ? status.price : undefined,
          now === undefined ? undefined : new Date(now)
        )
  let label = t('Cost estimate unavailable')
  if (pricing.isLoading || statusLoading) {
    label = t('Estimating cost…')
  }
  if (cost !== null) {
    label = t('Estimated cost {{amount}}', {
      amount: formatCnyCurrencyAmount(cost, {
        digitsLarge: 6,
        digitsSmall: 6,
        abbreviate: false,
        locale: toIntlLocale(i18n.resolvedLanguage || i18n.language),
      }),
    })
  }
  return (
    <p
      className='studio-cost-estimate'
      aria-live='polite'
      aria-atomic='true'
      title={t('Estimated at the base recharge rate. Final usage may vary.')}
    >
      {label}
    </p>
  )
}
