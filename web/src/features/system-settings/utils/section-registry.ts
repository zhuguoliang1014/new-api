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
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'

/**
 * Section definition for settings pages
 */
export type SectionDefinition<TSettings, TExtraArgs extends unknown[] = []> = {
  id: string
  titleKey: string
  build: (settings: TSettings, ...extraArgs: TExtraArgs) => ReactNode
}

/**
 * Section registry configuration
 */
export type SectionRegistryConfig<
  TSectionId extends string,
  TSettings,
  TExtraArgs extends unknown[] = [],
> = {
  sections: readonly SectionDefinition<TSettings, TExtraArgs>[]
  defaultSection: TSectionId
  basePath: string
  /** 'query' = `${basePath}?section=${id}`, 'path' = `${basePath}/${id}` */
  urlStyle?: 'query' | 'path'
}

/** Navigation metadata can be imported by route guards without loading page builders. */
export function createSectionNavigation<
  const TSectionId extends string,
>(config: {
  sections: readonly {
    id: TSectionId
    titleKey: string
    descriptionKey?: string
  }[]
  defaultSection: TSectionId
  basePath: string
  urlStyle?: 'query' | 'path'
}) {
  const { sections, defaultSection, basePath, urlStyle = 'query' } = config
  const sectionIds = sections.map((section) => section.id) as [
    TSectionId,
    ...TSectionId[],
  ]

  function getSectionNavItems(
    t: TFunction,
    badges?: Partial<Record<TSectionId, string>>
  ) {
    return sections.map((section) => ({
      title: t(section.titleKey),
      url:
        urlStyle === 'path'
          ? `${basePath}/${section.id}`
          : `${basePath}?section=${section.id}`,
      badge: badges?.[section.id],
    }))
  }

  function getSectionMeta(sectionId: TSectionId) {
    return sections.find((section) => section.id === sectionId) ?? sections[0]
  }

  return { sectionIds, defaultSection, getSectionNavItems, getSectionMeta }
}

/** Create the content registry only inside the corresponding lazy page. */
export function createSectionRegistry<
  TSectionId extends string,
  TSettings,
  TExtraArgs extends unknown[] = [],
>(config: SectionRegistryConfig<TSectionId, TSettings, TExtraArgs>) {
  const navigation = createSectionNavigation({
    ...config,
    sections: config.sections as readonly (SectionDefinition<
      TSettings,
      TExtraArgs
    > & { id: TSectionId })[],
  })

  function getSectionMeta(sectionId: TSectionId) {
    return (
      config.sections.find((section) => section.id === sectionId) ??
      config.sections[0]
    )
  }

  function getSectionContent(
    sectionId: TSectionId,
    settings: TSettings,
    ...extraArgs: TExtraArgs
  ) {
    return getSectionMeta(sectionId).build(settings, ...extraArgs)
  }

  return { ...navigation, getSectionContent, getSectionMeta }
}
