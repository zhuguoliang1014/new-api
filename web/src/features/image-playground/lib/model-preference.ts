/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { z } from 'zod'

export const studioDefaultModel = 'gpt-image-2.5-flare-basic'
const schema = z.object({
  model: z.string().min(1).max(200),
  group: z.string().min(1).max(200),
})
export function readStudioModelPreference(ownerId: number | undefined) {
  if (!ownerId) return null
  try {
    const value = schema.safeParse(
      JSON.parse(
        localStorage.getItem(`image-studio-model-v1:${ownerId}`) ?? 'null'
      )
    )
    return value.success ? value.data : null
  } catch {
    return null
  }
}
export function saveStudioModelPreference(
  ownerId: number | undefined,
  value: z.infer<typeof schema>
) {
  if (!ownerId) return false
  try {
    localStorage.setItem(
      `image-studio-model-v1:${ownerId}`,
      JSON.stringify(schema.parse(value))
    )
    return true
  } catch {
    return false
  }
}
