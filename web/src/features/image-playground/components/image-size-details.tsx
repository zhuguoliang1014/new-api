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
import { useTranslation } from 'react-i18next'

export type ImageDimensions = { width: number; height: number }

export function ImageSizeDetails(props: {
  dimensions: ImageDimensions | null
  requestedSize?: string
}) {
  const { t } = useTranslation()
  const actual = props.dimensions
    ? `${props.dimensions.width}x${props.dimensions.height}`
    : null
  const mismatch = Boolean(
    actual &&
    props.requestedSize &&
    props.requestedSize !== 'auto' &&
    props.requestedSize !== actual
  )
  return (
    <div className='studio-image-dimensions'>
      <span>
        {actual
          ? t('Original: {{size}}', { size: actual.replace('x', ' × ') })
          : t('Original dimensions unavailable')}
      </span>
      {props.requestedSize && props.requestedSize !== 'auto' && (
        <span>
          {t('Requested: {{size}}', {
            size: props.requestedSize.replace('x', ' × '),
          })}
        </span>
      )}
      {mismatch && (
        <p className='studio-size-mismatch' role='status'>
          {t(
            'The returned image dimensions differ from the request. Check the original and your consumption record.'
          )}
        </p>
      )}
    </div>
  )
}
