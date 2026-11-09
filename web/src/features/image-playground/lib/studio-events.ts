/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { nanoid } from 'nanoid'

import { api } from '@/lib/api'

import { getImageAuthScope } from '../api'

type StudioInteraction = {
  action:
    | 'page_opened'
    | 'mode_selected'
    | 'library_opened'
    | 'reference_selected'
    | 'assistant_opened'
  mode: 'general' | 'portrait'
  role?: string
  asset_id?: string
}
let lastOpen: { scope: string; time: number } | undefined
export function trackStudioEvent(event: StudioInteraction): void {
  const scope = getImageAuthScope()
  if (!scope) return
  if (event.action === 'page_opened') {
    if (lastOpen?.scope === scope && Date.now() - lastOpen.time < 30000) return
    lastOpen = { scope, time: Date.now() }
  }
  // Never send prompts, file names, URLs, image data or credentials as analytics fields.
  void api
    .post(
      '/api/image-playground/events',
      { event_id: nanoid(), ...event },
      { skipAuthRefresh: true, skipErrorHandler: true }
    )
    .catch(() => undefined)
}
