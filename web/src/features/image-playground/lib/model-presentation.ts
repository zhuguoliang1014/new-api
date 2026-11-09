/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { TFunction } from 'i18next'

/** UI names only. Model values remain the exact authorized, priced API identifiers. */
export function studioModelPresentation(model: string, t: TFunction) {
  const gpt =
    /^gpt-image-(\d+(?:\.\d+)?)(?:-(flare|sunburst))?(?:-(basic|native|hq))?$/i.exec(
      model
    )
  if (gpt) {
    const variant = gpt[2]
      ? ` ${gpt[2][0].toUpperCase()}${gpt[2].slice(1).toLowerCase()}`
      : ''
    const name = `GPT Image ${gpt[1]}${variant}`
    if (!gpt[3]) {
      return {
        name,
        label: name,
        category: 'GPT Image',
        subcategory: undefined,
        description: undefined,
      }
    }
    const delivery =
      gpt[3]?.toLowerCase() === 'native'
        ? t('Native images')
        : t('Upscaled images')
    return {
      name,
      label: `${name} · ${delivery}`,
      category: 'GPT Image',
      subcategory: delivery,
      description:
        gpt[3]?.toLowerCase() === 'native'
          ? t(
              'Native output for detailed image editing and reference composition.'
            )
          : t(
              'Low-cost upscaled images for everyday creation and reference composition.'
            ),
    }
  }
  if (model.startsWith('gemini-')) {
    let name = `${t('Banana')} · Gemini 2.5 Flash`
    if (model.includes('3.1-flash')) name = t('Banana 2')
    else if (model.includes('3-pro')) name = t('Banana Pro')
    else if (model.includes('nano-banana-2.1')) name = `${t('Banana')} 2.1`
    const label = model.endsWith('-preview')
      ? `${name} · ${t('Preview release')}`
      : name
    return {
      name,
      label,
      category: t('Banana'),
      subcategory: undefined,
      description: t(
        'Banana models for image editing and combining visual references.'
      ),
    }
  }
  if (model.startsWith('mj-v')) {
    const name = `Midjourney ${model.slice(3)}`
    return {
      name,
      label: name,
      category: 'Midjourney',
      subcategory: undefined,
      description: t('Midjourney for stylized composition and illustration.'),
    }
  }
  const name = model
    .replace(/-(basic|native|hq)$/i, '')
    .replaceAll(/[-_]/g, ' ')
  return {
    name,
    label: name,
    category: t('Other'),
    subcategory: undefined,
    description: undefined,
  }
}
export function studioModelLabel(model: string, t: TFunction): string {
  return studioModelPresentation(model, t).label
}
