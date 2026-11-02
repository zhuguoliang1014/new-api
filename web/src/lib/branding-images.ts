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
import favicon from '@/assets/branding/aiproxy-favicon.png?inline'
import logo from '@/assets/branding/aiproxy-logo.png?inline'

const BRAND_SOURCE_PATH =
  '/static/uploads/images/20261029-aiproxy-brand-light-52157c6838a3.png'

/** Use display-sized copies of the exact configured brand; preserve all custom logos. */
export function getBrandingImage(
  source: string,
  purpose: 'logo' | 'favicon' = 'logo'
): string {
  try {
    const url = new URL(source, 'https://92ai.asia')
    if (
      url.origin !== 'https://92ai.asia' ||
      url.pathname !== BRAND_SOURCE_PATH
    ) {
      return source
    }
    return purpose === 'favicon' ? favicon : logo
  } catch {
    return source
  }
}
