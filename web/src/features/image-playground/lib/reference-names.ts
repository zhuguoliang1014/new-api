/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import type { TFunction } from 'i18next'

import type { ImageReference } from '../types'
import {
  portraitLabels,
  portraitSlotLabels,
  type LocalizedReferenceText,
  type PortraitAsset,
  type PortraitSlot,
} from './portrait-elements'

/** Product labels are independent of upstream filenames, codes and provenance. */
export function createReferenceTitle(
  item: {
    kind: 'pose' | 'costume' | 'character'
    title: LocalizedReferenceText
    category: LocalizedReferenceText
    portrait?: { section: string; hair: string }
  },
  ordinal: number
): LocalizedReferenceText {
  const number = String(ordinal).padStart(3, '0')
  if (item.kind === 'character') {
    const hair = item.portrait?.hair
    const names: Record<string, LocalizedReferenceText> = {
      short: { zh: '短发', en: 'Short hair' },
      medium: { zh: '中发', en: 'Medium hair' },
      'medium-long': { zh: '中长发', en: 'Shoulder-length hair' },
      long: { zh: '长发', en: 'Long hair' },
    }
    const base = names[hair ?? '']
    const styling = item.portrait?.section === 'styling'
    return {
      zh: `${base?.zh ?? ''}${styling ? '人物造型' : '人像'} ${number}`,
      en: `${base ? `${base.en} · ` : ''}${styling ? 'Character' : 'Portrait'} ${number}`,
    }
  }
  const cleanZh = item.title.zh
    .replace(/^(?:女性|男性|模特舞蹈|模特站姿)(?:站姿|坐姿)?\s*[·・]\s*/, '')
    .replaceAll('女孩坐', 'W坐姿')
    .replaceAll(/[·・]/g, '，')
    .replaceAll(/\s+/g, ' ')
    .trim()
  const cleanEn = item.title.en
    .replace(/^(?:Female|Male|Model|Dance)\s*[·・]\s*/i, '')
    .replaceAll(/[·・]/g, ',')
    .replaceAll(/\s+/g, ' ')
    .trim()
  if (item.kind === 'costume') {
    return {
      zh: cleanZh.replaceAll(/\s*，\s*/g, '搭配'),
      en: cleanEn.replaceAll(/\s*\/\s*/g, ' with '),
    }
  }
  return {
    zh: `${item.category.zh} · ${cleanZh}`,
    en: /^(?:Seated|Standing) pose \d+$/i.test(cleanEn)
      ? `${item.category.en} study ${number}`
      : `${item.category.en} · ${cleanEn}`,
  }
}

export function referenceDisplayName(
  reference: ImageReference,
  t: TFunction,
  language: string,
  assets?: PortraitAsset[]
): string {
  const locale = language.startsWith('zh') ? 'zh' : 'en'
  const asset = assets?.find((item) => item.id === reference.assetId)
  if (asset) {
    return (
      portraitLabels(t)[asset.id] ||
      asset.displayTitle?.[locale] ||
      asset.title?.[locale] ||
      asset.name ||
      portraitSlotLabels(t)[asset.role]
    )
  }
  if (reference.assetTitle) return reference.assetTitle[locale]
  if (
    reference.assetId ||
    /^(?:identity|outfit|pose)-(?:custom_|portrait-|full_|pair)/.test(
      reference.file.name
    )
  ) {
    return (
      portraitSlotLabels(t)[reference.role as PortraitSlot] ||
      t('Reference image')
    )
  }
  return reference.file.name
}

/** Old saved drafts can contain upstream download filenames as their generated title. */
export function savedReferenceTitle(
  title: string,
  references: ImageReference[],
  t: TFunction,
  language: string,
  assets?: PortraitAsset[]
): string {
  if (
    !/(?:identity|pose|outfit)-(?:custom_|portrait-|full_|pair)|custom_(?:pose|costume|character)|(?:^| · )(?:identity|outfit|pose)-[^ ]+\.(?:webp|png)/.test(
      title
    )
  ) {
    return title
  }
  return (
    references
      .slice(0, 2)
      .map((reference) => referenceDisplayName(reference, t, language, assets))
      .join(' · ') || t('Untitled project')
  )
}
