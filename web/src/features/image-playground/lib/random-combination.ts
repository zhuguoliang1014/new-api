/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { ImageReference } from '../types'
import type { PortraitAsset } from './portrait-elements'

/** Pick all three slots before loading; prefer a new choice for every slot. */
export function randomCombination(
  assets: PortraitAsset[],
  current: ImageReference[],
  random: () => number = Math.random
): { asset: PortraitAsset; viewId?: string }[] {
  const roles = ['identity', 'outfit', 'pose'] as const
  const groups = roles.map((role) =>
    assets.filter((asset) => asset.role === role)
  )
  if (groups.some((group) => !group.length)) return []
  return groups.map((group, index) => {
    const previous = current.find((ref) => ref.role === roles[index])
    const different = group.filter((asset) => asset.id !== previous?.assetId)
    const candidates = different.length ? different : group
    const asset =
      candidates[
        Math.min(
          candidates.length - 1,
          Math.floor(random() * candidates.length)
        )
      ]
    const view =
      asset.views[
        Math.min(
          asset.views.length - 1,
          Math.floor(random() * asset.views.length)
        )
      ]
    return { asset, viewId: view?.id }
  })
}
