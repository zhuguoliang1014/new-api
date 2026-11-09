/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Check, ImagePlus, Loader2, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import type { usePortraitElements } from '../hooks/use-portrait-elements'
import type { useStudioCatalog } from '../hooks/use-studio-catalog'
import {
  portraitLabels,
  portraitSlotLabels,
  poseViewLabels,
  referenceForSlot,
  type PortraitSlot,
  type PortraitAsset,
} from '../lib/portrait-elements'
import {
  portraitAssetName,
  portraitViewName,
  selectedPortraitView,
} from '../lib/reference-catalog'
import {
  emptyLibraryFilters,
  filterLibraryAssets,
  libraryFacets,
  type LibraryFilters,
} from '../lib/reference-library'
import { useImagePlaygroundStore } from '../store'
import { ReferenceThumbnail } from './reference-thumbnail'

const emptyAssets: PortraitAsset[] = []
const roles: PortraitSlot[] = ['identity', 'outfit', 'pose', 'scene']
export function FashionReferencePicker(props: {
  role: PortraitSlot | null
  onRoleChange: (role: PortraitSlot) => void
  onClose: () => void
  elements: ReturnType<typeof usePortraitElements>
  catalog: ReturnType<typeof useStudioCatalog>
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage || i18n.language
  const locale = language.startsWith('zh') ? 'zh' : 'en'
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<LibraryFilters>(emptyLibraryFilters)
  const [page, setPage] = useState(0)
  const [depth, setDepth] = useState(false)
  const [views, setViews] = useState<Record<string, string>>({})
  const input = useRef<HTMLInputElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const references = useImagePlaygroundStore((s) => s.references)
  const labels = portraitLabels(t),
    roleLabels = portraitSlotLabels(t),
    angleLabels = poseViewLabels(t)
  const role = props.role ?? 'outfit'
  const selected = referenceForSlot(references, role)
  useEffect(() => {
    setQuery('')
    setFilters(emptyLibraryFilters)
    setPage(0)
    setDepth(false)
  }, [props.role])
  const allAssets = props.catalog.data ?? emptyAssets
  const assets = useMemo(
    () => filterLibraryAssets(allAssets, role, query, filters),
    [allAssets, role, query, filters]
  )
  const facets = useMemo(
    () => libraryFacets(allAssets.filter((a) => a.role === role)),
    [allAssets, role]
  )
  const pageSize = 24
  const pageCount = Math.max(1, Math.ceil(assets.length / pageSize))
  const activePage = Math.min(page, pageCount - 1)
  const visibleAssets = assets.slice(
    activePage * pageSize,
    (activePage + 1) * pageSize
  )
  const changePage = (next: number) => {
    setPage(next)
    grid.current?.scrollIntoView?.({ block: 'start' })
  }
  const updateFilter = (key: keyof LibraryFilters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(0)
  }
  const filterFields = [
    { key: 'category' as const, label: t('Category'), values: facets.category },
    { key: 'subject' as const, label: t('Subject'), values: facets.subject },
    { key: 'style' as const, label: t('Image type'), values: facets.style },
    {
      key: 'country' as const,
      label: t('Country / region'),
      values: facets.country,
    },
  ].filter((field) => field.values.length > 0)
  const canUpload = role === 'identity' || role === 'scene'
  const descriptions = {
    identity: t('Choose a portrait, or upload a person photo.'),
    outfit: t('Choose the outfit you want the person to wear.'),
    pose: t(
      'Choose a reference. For poses, choose the camera angle before adding it.'
    ),
    scene: t('Choose a background and lighting reference.'),
  }
  return (
    <Dialog
      open={Boolean(props.role)}
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('Choose {{element}}', { element: roleLabels[role] })}
      description={descriptions[role]}
      contentClassName='shoot-picker sm:max-w-5xl'
      contentHeight='72vh'
    >
      <div className='shoot-picker-toolbar'>
        <div
          className='shoot-category-tabs'
          role='group'
          aria-label={t('Element library')}
        >
          {roles.map((item) => (
            <Button
              key={item}
              size='sm'
              variant={role === item ? 'secondary' : 'ghost'}
              aria-pressed={role === item}
              onClick={() => props.onRoleChange(item)}
            >
              {roleLabels[item]}
            </Button>
          ))}
        </div>
        <div className='shoot-picker-search'>
          <Search size={15} />
          <Input
            aria-label={t('Search elements')}
            placeholder={t('Search elements')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(0)
            }}
          />
        </div>
      </div>
      <div className='studio-library-filters'>
        {filterFields.map((field) => (
          <NativeSelect
            key={field.key}
            aria-label={field.label}
            value={filters[field.key]}
            onChange={(e) => updateFilter(field.key, e.target.value)}
          >
            <NativeSelectOption value=''>
              {field.label} · {t('All')}
            </NativeSelectOption>
            {field.values.map((value) => (
              <NativeSelectOption key={value.id} value={value.id}>
                {value[locale]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ))}
        {facets.hair.length > 0 && (
          <NativeSelect
            aria-label={t('Hair length')}
            value={filters.hair}
            onChange={(e) => updateFilter('hair', e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('Hair length')} · {t('All')}
            </NativeSelectOption>
            {facets.hair.map((hair) => (
              <NativeSelectOption key={hair} value={hair}>
                {{
                  short: t('Short hair'),
                  medium: t('Medium hair'),
                  'medium-long': t('Medium-long hair'),
                  long: t('Long hair'),
                  bald: t('Bald'),
                }[hair] || hair}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </div>
      <div className='shoot-picker-sources'>
        <span>{t('{{count}} references', { count: assets.length })}</span>
        {role === 'pose' && (
          <Button
            size='sm'
            variant='outline'
            aria-pressed={depth}
            onClick={() => setDepth((value) => !value)}
          >
            {t('Depth map')}
          </Button>
        )}
        {canUpload && (
          <Button
            variant='outline'
            size='sm'
            disabled={Boolean(props.elements.loading)}
            onClick={() => input.current?.click()}
          >
            <ImagePlus size={14} />
            {t('Upload {{element}}', { element: roleLabels[role] })}
          </Button>
        )}
      </div>
      {role === 'pose' && (
        <p className='shoot-picker-hint'>
          {t(
            'Camera views use different reference images, not a mirrored preview.'
          )}
        </p>
      )}
      {props.catalog.isError && (
        <p role='alert'>
          {t('Could not load the reference library.')}{' '}
          <Button
            size='sm'
            variant='outline'
            onClick={() => void props.catalog.refetch()}
          >
            {t('Retry')}
          </Button>
        </p>
      )}
      {props.catalog.isLoading && <p role='status'>{t('Loading...')}</p>}
      <div className='shoot-library-grid' ref={grid}>
        {visibleAssets.map((asset) => {
          const viewId =
            views[asset.id] ??
            (selected?.assetId === asset.id
              ? selected.assetView?.replace(/:depth$/, '')
              : undefined) ??
            asset.views[0]?.id
          const useDepth =
            depth && asset.views.some((v) => v.id === viewId && v.depth)
          const selectedViewId = useDepth ? `${viewId}:depth` : viewId
          const view = selectedPortraitView(asset, selectedViewId)
          const name = labels[asset.id] || portraitAssetName(asset, language)
          const isSelected =
            selected?.assetId === asset.id &&
            selected.assetView === selectedViewId
          return (
            <div key={asset.id} className='studio-library-entry'>
              <Button
                variant='ghost'
                className='shoot-library-card'
                title={name}
                aria-label={t('Select {{name}}', { name })}
                aria-pressed={isSelected}
                disabled={Boolean(props.elements.loading)}
                onClick={async () => {
                  if (await props.elements.choose(asset, selectedViewId)) {
                    props.onClose()
                  }
                }}
              >
                <div>
                  <ReferenceThumbnail
                    src={
                      view?.preview ?? view?.thumbnail ?? view?.src ?? asset.src
                    }
                    alt={name}
                    lazy
                  />
                  {isSelected && (
                    <span className='shoot-card-check'>
                      <Check size={15} />
                    </span>
                  )}
                  {props.elements.loading === asset.id && (
                    <span className='shoot-card-loading'>
                      <Loader2 size={22} className='animate-spin' />
                    </span>
                  )}
                </div>
                <strong>{name}</strong>
                {asset.category && (
                  <small>
                    {asset.role === 'pose'
                      ? t('{{count}} camera views', {
                          count: asset.views.length,
                        })
                      : asset.category[locale]}
                  </small>
                )}
              </Button>
              {asset.role === 'pose' && asset.views.length > 0 && (
                <div
                  className='studio-angle-options'
                  role='group'
                  aria-label={t('Camera angles for {{name}}', { name })}
                >
                  {asset.views.map((v) => (
                    <Button
                      key={v.id}
                      variant='ghost'
                      size='sm'
                      aria-label={portraitViewName(v, language, angleLabels)}
                      aria-pressed={v.id === viewId}
                      disabled={Boolean(props.elements.loading)}
                      onClick={() => setViews({ ...views, [asset.id]: v.id })}
                    >
                      <ReferenceThumbnail
                        src={
                          (depth ? v.depth?.thumbnail : undefined) ??
                          v.thumbnail ??
                          v.src
                        }
                        alt=''
                        lazy
                        compact
                      />
                      <span>{portraitViewName(v, language, angleLabels)}</span>
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {assets.length > pageSize && (
        <div className='studio-library-pagination'>
          <Button
            size='sm'
            variant='outline'
            disabled={activePage === 0}
            onClick={() => changePage(activePage - 1)}
          >
            {t('Previous page')}
          </Button>
          <span role='status'>
            {t('Page {{page}} of {{total}}', {
              page: activePage + 1,
              total: pageCount,
            })}
          </span>
          <Button
            size='sm'
            variant='outline'
            disabled={activePage + 1 >= pageCount}
            onClick={() => changePage(activePage + 1)}
          >
            {t('Next page')}
          </Button>
        </div>
      )}
      {!assets.length && !props.catalog.isLoading && !props.catalog.isError && (
        <p role='status' className='shoot-library-empty'>
          {t('No matching elements. Try another search.')}
        </p>
      )}
      {props.elements.error && (
        <p role='alert' className='studio-field-error'>
          {props.elements.error}
        </p>
      )}
      {canUpload && (
        <input
          ref={input}
          hidden
          type='file'
          accept='image/png,image/jpeg,image/webp'
          aria-label={t('Upload selected element')}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file && props.elements.upload(role, file)) props.onClose()
            e.target.value = ''
          }}
        />
      )}
    </Dialog>
  )
}
