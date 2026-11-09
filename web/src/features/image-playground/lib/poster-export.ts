/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { t } from 'i18next'

import type { PosterSettings } from './creative'

export function wrapPosterText(
  text: string,
  measure: (value: string) => number,
  maxWidth: number
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const char of paragraph) {
      if (line && measure(line + char) > maxWidth) {
        lines.push(line)
        line = ''
      }
      line += char
    }
    lines.push(line)
  }
  return lines
}

export async function exportPoster(
  blob: Blob,
  settings: PosterSettings
): Promise<Blob> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
    throw new Error(
      t('Choose a static PNG, JPEG or WebP image for the poster.')
    )
  }
  const src = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    await document.fonts.ready
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(t('Poster export is unavailable.'))
    ctx.drawImage(img, 0, 0)
    ctx.fillStyle = settings.color
    ctx.textAlign = settings.align
    ctx.textBaseline = 'top'
    const x =
      settings.align === 'left' ? canvas.width * 0.085 : canvas.width * 0.5
    const blocks = [
      {
        text: settings.kicker,
        size: canvas.width * 0.022,
        weight: 500,
        gap: canvas.width * 0.025,
      },
      {
        text: settings.title,
        size: (canvas.width * settings.size) / 100,
        weight: 500,
        gap: canvas.width * 0.025,
      },
      {
        text: settings.subtitle,
        size: canvas.width * 0.026,
        weight: 400,
        gap: 0,
      },
    ].filter((b) => b.text.trim())
    const layouts = blocks.map((block) => {
      ctx.font = `${block.weight} ${block.size}px "Public Sans Variable", "PingFang SC", "Microsoft YaHei", sans-serif`
      const lines = wrapPosterText(
        block.text,
        (s) => ctx.measureText(s).width,
        canvas.width * 0.83
      )
      return { ...block, lines, height: lines.length * block.size * 1.25 }
    })
    const total = layouts.reduce(
      (sum, block) => sum + block.height + block.gap,
      0
    )
    if (total > canvas.height * 0.83) {
      throw new Error(
        t('The text exceeds the poster. Shorten it or reduce the title size.')
      )
    }
    let y =
      settings.position === 'top'
        ? canvas.height * 0.065
        : canvas.height * 0.935 - total
    for (const block of layouts) {
      ctx.font = `${block.weight} ${block.size}px "Public Sans Variable", "PingFang SC", "Microsoft YaHei", sans-serif`
      for (const line of block.lines) {
        ctx.fillText(line, x, y)
        y += block.size * 1.25
      }
      y += block.gap
    }
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error(t('Poster export is unavailable.'))),
        'image/png'
      )
    )
  } finally {
    URL.revokeObjectURL(src)
  }
}
