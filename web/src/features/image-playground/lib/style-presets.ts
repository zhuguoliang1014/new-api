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

import type { ImageRecord } from '../types'

export type StylePreset = {
  /** Stable key used in i18n and as array identifier. */
  id: string
  /** English display label (used as the i18n source key). */
  label: string
  /** Prompt suffix appended after the user's own prompt.
   *  [SUBJECT] is replaced with the user's prompt at generation time. */
  promptTemplate: string
  /** Path to the bundled preview thumbnail relative to /public. */
  previewSrc: string
}

export const stylePresets: StylePreset[] = [
  {
    id: 'product',
    label: 'Product photography',
    previewSrc: '/style-previews/product.jpg',
    promptTemplate: `[SUBJECT] placed on a rough-textured travertine stone block.
Raking warm afternoon sidelight from the upper left, soft botanical leaf shadows
cast across a warm plaster wall in the background. Shot with an 85mm macro lens
at f/2.8, shallow depth of field keeping the subject razor-sharp while the
surround dissolves into cream bokeh. Color palette: warm stone, honey, cream and
off-white. Minimal styling — nothing competes with the subject. The lighting
reveals every surface texture and material detail. Post-processing: subtle warm
grade, lifted shadows, no crushed blacks. Editorial still-life photograph quality,
suitable for a luxury brand campaign. Ultra-detailed, high dynamic range.
No text, no logo, no watermark, no reflections of the photographer.`,
  },
  {
    id: 'portrait',
    label: 'Portrait',
    previewSrc: '/style-previews/portrait.jpg',
    promptTemplate: `Portrait of [SUBJECT]. Soft natural window light entering from
camera left, a thin white diffusion scrim softening it to wrap the face gently.
85mm f/1.4 lens, subject sharp from eyes to tip of nose, ears and background in
soft progressive blur. Catchlights visible in both eyes. Skin texture is
faithfully preserved — no over-smoothing — with natural subsurface scattering
giving warmth to highlighted areas. Color grade: warm highlights, slightly
desaturated midtones, deep but not crushed shadows. Background is a simple muted
wall or neutral drape. Framing is tight headshot to loose bust. Mood: intimate,
calm, a quiet moment of presence. Captured in the style of a high-end editorial
portrait session. No text, no logo, no watermark, no artificial studio backdrop.`,
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    previewSrc: '/style-previews/cinematic.jpg',
    promptTemplate: `[SUBJECT] as a cinematic still frame from a prestige arthouse
film. Composed in 2.39:1 anamorphic widescreen with gentle letterbox crop. Film
grain from Kodak Vision3 5219 500T stock. Teal-orange color grade with slightly
lifted blacks and milky highlights. Motivated practical lighting — warm tungsten
from a window or lamp inside the frame — with deep directional shadows.
Characters placed in mid-shot or wider, surrounded by a meaningful environment
that extends the narrative. Lens: 35mm anamorphic, slight oval bokeh in
out-of-focus areas, subtle breathing and vignette. The mood is contemplative,
unhurried, and weighted — like a Villeneuve or Wong Kar-wai frame frozen in time.
No text, no subtitles, no on-screen graphics, no watermark.`,
  },
  {
    id: 'neon',
    label: 'Neon night',
    previewSrc: '/style-previews/neon.jpg',
    promptTemplate: `[SUBJECT] in a rain-soaked urban street at night. Neon signs
in cyan, magenta and amber reflect in wet black pavement, doubling every light
source into shifting liquid pools. Heavy atmospheric haze and steam rising from
drainage grates. Lighting is entirely practical — signs, car headlights, backlit
translucent awnings — with no fill light, creating high contrast between lit and
shadow areas. Shot on 35mm, slight chromatic aberration on the neon edges. Color
palette dominated by electric cyan and deep magenta with warm amber accents and
near-black darks. Dense foreground detail, atmospheric mid-ground with
silhouettes, hazy light-bloom in the distance. Cinematic and electric, inspired
by Blade Runner 2049 and Wong Kar-wai's mood cinematography. Ultra-detailed.
No text, no logo, no watermark.`,
  },
  {
    id: 'watercolor',
    label: 'Watercolor',
    previewSrc: '/style-previews/watercolor.jpg',
    promptTemplate: `[SUBJECT] rendered as a high-quality watercolor illustration.
Paper texture is clearly visible throughout — 300gsm cold-press with natural
tooth. Wet-on-wet color blooms in the soft areas, pigment granulation in the
shadows, visible water marks where washes dried. Transparent layered washes build
depth in the darks without losing luminosity. Delicate ink linework outlines forms
where needed, loosening to near-absence in the open areas. Generous white paper
showing through in the highlights — no white paint used. Color palette is pastel
and airy with one deeper saturated accent color. The overall feel is loose,
spontaneous, and painterly — skilled editorial illustration seen in quality
publishing or high-end greeting card art.
No text, no logo, no digital artifacts, no flat vector areas.`,
  },
  {
    id: 'oilpainting',
    label: 'Oil painting',
    previewSrc: '/style-previews/oilpainting.jpg',
    promptTemplate: `[SUBJECT] as a classical oil painting on linen canvas. Visible
impasto brushwork catches raking light — thick peaks of paint in the lights,
thinner scumbled layers in the shadows. Rembrandt-style chiaroscuro lighting: a
single warm ambient source from upper left creates a deep shadow zone that merges
with a dark background, isolating the subject. Rich saturated color in the
directly lit areas, desaturated and cooler in the shadows with transparent glazes
over darker grounds. Canvas texture visible through the paint film in the thinner
passages. Composition follows classical portraiture or still-life traditions —
centered subject, balanced tonal masses. Old master style, unmistakably painted
rather than photographic. Museum-quality execution.
No text, no logo, no digital sharpening artifacts, no watermark.`,
  },
  {
    id: 'minimal',
    label: 'Japanese minimal',
    previewSrc: '/style-previews/minimal.jpg',
    promptTemplate: `[SUBJECT] photographed in a Japanese minimalist aesthetic.
Generous negative space — at least 60% of the frame is empty, allowing the
subject to breathe. Light is soft, ambient and directionless, entering from a
large north-facing window or overcast sky, creating almost no shadows. Color
palette is tightly constrained: two or three muted, slightly warm neutral tones —
linen, soft stone, pale sage — with no saturated colors. Props if any are singular
and carefully chosen. Background is a plain white or off-white wall or seamless,
slightly warm in tone. Composition is asymmetric, placing the subject off-center
following the quiet logic of ma (間) — the meaningful emptiness. The feeling is
meditative and spacious, like a Muji campaign or a Kinfolk magazine spread.
No text, no logo, no busy backgrounds, no harsh shadows, no watermark.`,
  },
  {
    id: 'conceptart',
    label: 'Concept art',
    previewSrc: '/style-previews/conceptart.jpg',
    promptTemplate: `[SUBJECT] as professional cinematic concept art for a AAA game
or major film production. Detailed environment painting with strong foreground
frame elements, a richly developed mid-ground where the main subject sits, and an
atmospheric background receding into aerial perspective haze. Dramatic volumetric
light rays breaking through the scene — a single dominant light source (sun, fire,
or magical) casting long shadows and picking out particles in the air. Color
script: one dominant hue controls the scene, a complementary accent appears in the
key light, black in the deep shadows. Epic scale and proportion — architecture or
environments dwarf human figures. Expert digital matte painting with painterly
edges and photorealistic textures, in the style of Feng Zhu, Craig Mullins or
WETA Workshop concept art. No text, no UI overlays, no logo, no watermark.`,
  },
]

/**
 * Inject the user's prompt into a style template.
 * The template's [SUBJECT] placeholder is replaced; if absent the prompt
 * is prepended before the template as a natural-language preamble.
 */
export function applyStyleTemplate(
  userPrompt: string,
  template: string
): string {
  const subject = userPrompt.trim()
  if (template.includes('[SUBJECT]')) {
    return template.replace('[SUBJECT]', subject)
  }
  return subject ? `${subject}\n\n${template}` : template
}

/** Recover the user's words from the exact template stored by older releases.
 * Partial matches and user-authored English must remain untouched. New records
 * carry styleId (including null), so their prompts never need inference. */
export function restoreLegacyStyleRecord(record: ImageRecord): ImageRecord {
  if (record.styleId !== undefined) return record
  for (const preset of stylePresets) {
    const [prefix, suffix] = preset.promptTemplate.split('[SUBJECT]')
    if (
      !suffix ||
      !record.parameters.prompt.startsWith(prefix) ||
      !record.parameters.prompt.endsWith(suffix)
    ) {
      continue
    }
    const prompt = record.parameters.prompt.slice(prefix.length, -suffix.length)
    if (!prompt.trim()) continue
    return {
      ...record,
      parameters: { ...record.parameters, prompt },
      styleId: preset.id,
    }
  }
  return { ...record, styleId: null }
}
