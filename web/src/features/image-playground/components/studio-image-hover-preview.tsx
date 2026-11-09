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
import { useState, type ReactElement } from 'react'

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card'
import { useMediaQuery } from '@/hooks/use-media-query'

import { ReferenceThumbnail } from './reference-thumbnail'

type StudioImageHoverPreviewProps = {
  src: string
  label: string
  imageLabel?: string
  trigger: ReactElement
  enabled?: boolean
  large?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/** A non-modal image preview shared by style choices and uploaded references. */
export function StudioImageHoverPreview(props: StudioImageHoverPreviewProps) {
  const [open, setOpen] = useState(false)
  const hoverAvailable = useMediaQuery(
    '(min-width: 768px) and (hover: hover) and (pointer: fine)'
  )
  if (props.enabled === false || (props.large && !hoverAvailable)) {
    return props.trigger
  }
  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        delay={180}
        closeDelay={100}
        render={props.trigger}
        onFocus={() => {
          if (props.large) setOpen(true)
        }}
        onBlur={() => {
          if (props.large) setOpen(false)
        }}
        onPointerUp={(event) => {
          // Picker taps select the image; existing upload/style previews retain tap-to-preview.
          if (event.pointerType === 'touch' && !props.large) {
            setOpen((current) => !current)
          }
        }}
      />
      <HoverCardContent
        side={props.side ?? 'top'}
        align='start'
        alignOffset={0}
        sideOffset={14}
        className={`studio-image-hover-preview${props.large ? ' is-reference-preview' : ''}`}
      >
        <figure>
          <ReferenceThumbnail
            src={props.src}
            alt={props.imageLabel ?? props.label}
          />
          <figcaption>{props.label}</figcaption>
        </figure>
      </HoverCardContent>
    </HoverCard>
  )
}
