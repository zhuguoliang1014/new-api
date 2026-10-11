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

type StudioImageHoverPreviewProps = {
  src: string
  label: string
  imageLabel?: string
  trigger: ReactElement
}

/** A non-modal image preview shared by style choices and uploaded references. */
export function StudioImageHoverPreview(props: StudioImageHoverPreviewProps) {
  const [open, setOpen] = useState(false)
  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <HoverCardTrigger
        delay={180}
        closeDelay={100}
        render={props.trigger}
        onPointerUp={(event) => {
          // Touch has no hover. A tap opens the same card, with outside-tap dismissal.
          if (event.pointerType === 'touch') setOpen((current) => !current)
        }}
      />
      <HoverCardContent
        side='top'
        align='start'
        alignOffset={0}
        sideOffset={14}
        className='studio-image-hover-preview'
      >
        <figure>
          <img
            src={props.src}
            alt={props.imageLabel ?? props.label}
            referrerPolicy='no-referrer'
          />
          <figcaption>{props.label}</figcaption>
        </figure>
      </HoverCardContent>
    </HoverCard>
  )
}
