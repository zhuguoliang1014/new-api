/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { ShuffleIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { ChevronDown, ImagePlus, Loader2, Check, Plus, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import type { CreativeWorkspaceState } from '../hooks/use-creative-workspace'
import type { usePortraitElements } from '../hooks/use-portrait-elements'
import { fashionShootLabels, type FashionShoot } from '../lib/fashion-shoot'
import {
  portraitSlotLabels,
  poseViewLabels,
  referenceForSlot,
  type PortraitAsset,
  type PortraitSlot,
} from '../lib/portrait-elements'
import { portraitViewName } from '../lib/reference-catalog'
import { referenceDisplayName } from '../lib/reference-names'
import { useImagePlaygroundStore } from '../store'
import { ReferenceSlotArtwork } from './reference-slot-artwork'
import { ReferenceThumbnail } from './reference-thumbnail'
import { StudioImageHoverPreview } from './studio-image-hover-preview'

const slots = ['identity', 'outfit', 'pose'] as const
export function FashionShootControls(props: {
  state: CreativeWorkspaceState
  elements: ReturnType<typeof usePortraitElements>
  onChoose: (role: PortraitSlot) => void
  assets: PortraitAsset[]
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.resolvedLanguage || i18n.language
  const references = useImagePlaygroundStore((s) => s.references)
  const roles = portraitSlotLabels(t),
    angles = poseViewLabels(t),
    shootLabels = fashionShootLabels(t)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const disabled =
    props.state.executing ||
    props.state.selectingElements ||
    props.state.planning
  const pose = referenceForSlot(references, 'pose')
  const poseAsset = props.assets.find(
    (a) => a.role === 'pose' && a.id === pose?.assetId
  )
  const selectedView =
    poseAsset?.views.find(
      (view) => view.id === pose?.assetView?.replace(/:depth$/, '')
    ) ?? poseAsset?.views[0]
  const depthSelected = Boolean(pose?.assetView?.endsWith(':depth'))
  const extra = references.filter((r) => !slots.some((role) => r.role === role))
  const fields: { key: keyof FashionShoot; label: string }[] = [
    { key: 'body', label: t('Model build') },
    { key: 'stature', label: t('Model stature') },
    { key: 'framing', label: t('Framing') },
  ]
  return (
    <>
      <section className='compose-reference-section'>
        <div className='compose-section-heading'>
          <h3>{t('Build your combination')}</h3>
          <Button
            variant='ghost'
            size='sm'
            className='compose-random-combination'
            disabled={
              disabled ||
              !slots.every((role) =>
                props.assets.some((asset) => asset.role === role)
              )
            }
            onClick={() => void props.elements.randomize(props.assets)}
          >
            {props.elements.loading === 'random-combination' ? (
              <Loader2 className='animate-spin' data-icon='inline-start' />
            ) : (
              <HugeiconsIcon icon={ShuffleIcon} data-icon='inline-start' />
            )}
            {t('Random combination')}
          </Button>
        </div>
        <div className='compose-slots'>
          {slots.map((role) => {
            const reference = referenceForSlot(references, role)
            const asset = props.assets.find(
              (a) => a.id === reference?.assetId && a.role === role
            )
            const name = reference
              ? referenceDisplayName(reference, t, language, props.assets)
              : undefined
            return (
              <div className='compose-slot' key={role}>
                <div
                  className='compose-slot-visual'
                  onDragOver={(e) => {
                    if (role === 'identity') e.preventDefault()
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (
                      !disabled &&
                      role === 'identity' &&
                      e.dataTransfer.files[0]
                    ) {
                      props.elements.upload(role, e.dataTransfer.files[0])
                    }
                  }}
                  onPaste={(e) => {
                    if (
                      !disabled &&
                      role === 'identity' &&
                      e.clipboardData.files[0]
                    ) {
                      e.preventDefault()
                      props.elements.upload(role, e.clipboardData.files[0])
                    }
                  }}
                >
                  <StudioImageHoverPreview
                    src={reference?.preview ?? ''}
                    label={name ?? roles[role]}
                    enabled={Boolean(reference)}
                    large
                    side='right'
                    trigger={
                      <Button
                        variant='outline'
                        className={`compose-slot-pick${reference ? ' has-reference' : ''}`}
                        disabled={disabled}
                        title={name}
                        aria-label={t('Choose {{element}}', {
                          element: roles[role],
                        })}
                        onClick={() => props.onChoose(role)}
                      >
                        {reference ? (
                          <ReferenceThumbnail
                            src={reference.preview}
                            alt={name ?? roles[role]}
                          />
                        ) : (
                          <span className='compose-slot-placeholder'>
                            <ReferenceSlotArtwork role={role} />
                            <Plus size={14} />
                          </span>
                        )}
                      </Button>
                    }
                  />
                  {props.elements.loading &&
                    asset?.id === props.elements.loading && (
                      <span
                        className='compose-slot-loading'
                        role='status'
                        aria-label={t('Loading...')}
                      >
                        <Loader2 size={20} className='animate-spin' />
                      </span>
                    )}
                  {reference && (
                    <Button
                      variant='secondary'
                      size='icon'
                      className='compose-slot-remove'
                      disabled={disabled}
                      aria-label={t('Remove reference {{name}}', { name })}
                      onClick={() => props.elements.remove(role)}
                    >
                      <X size={12} />
                    </Button>
                  )}
                </div>
                <div className='compose-slot-label'>
                  <strong>{roles[role]}</strong>
                  {reference && <Check size={12} aria-hidden='true' />}
                </div>
                <span className='compose-slot-name' title={name}>
                  {name || t('Not selected')}
                </span>
                {role === 'identity' && (
                  <Button
                    variant='ghost'
                    size='sm'
                    className='compose-person-upload'
                    disabled={disabled}
                    onClick={() => input.current?.click()}
                  >
                    <ImagePlus size={13} />
                    {t('Upload person')}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
        <input
          ref={input}
          type='file'
          hidden
          accept='image/png,image/jpeg,image/webp'
          aria-label={t('Upload person')}
          disabled={disabled}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) props.elements.upload('identity', file)
            e.target.value = ''
          }}
        />
        {pose && poseAsset && (
          <div className='compose-pose-settings'>
            <div className='compose-angle-row'>
              <Label htmlFor='compose-camera'>{t('Camera angle')}</Label>
              <NativeSelect
                id='compose-camera'
                disabled={disabled}
                value={selectedView?.id}
                onChange={(e) => {
                  const view = poseAsset.views.find(
                    (item) => item.id === e.target.value
                  )
                  void props.elements.choose(
                    poseAsset,
                    `${e.target.value}${depthSelected && view?.depth ? ':depth' : ''}`
                  )
                }}
              >
                {poseAsset.views.map((view) => (
                  <NativeSelectOption key={view.id} value={view.id}>
                    {portraitViewName(view, language, angles)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            {selectedView?.depth && (
              <div className='compose-depth-row'>
                <div>
                  <Label htmlFor='compose-depth'>{t('Depth map')}</Label>
                  <p>{t('Use depth to guide the pose and viewpoint.')}</p>
                </div>
                <Switch
                  id='compose-depth'
                  checked={depthSelected}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    void props.elements.choose(
                      poseAsset,
                      `${selectedView.id}${checked ? ':depth' : ''}`
                    )
                  }
                />
              </div>
            )}
          </div>
        )}
        {extra.length > 0 && (
          <div className='compose-extra-references'>
            <Label>{t('Additional references')}</Label>
            {extra.map((ref) => (
              <div key={ref.id}>
                <img
                  src={ref.preview}
                  alt={referenceDisplayName(ref, t, language, props.assets)}
                />
                <span>
                  {referenceDisplayName(ref, t, language, props.assets)}
                </span>
                <Button
                  variant='ghost'
                  size='icon'
                  disabled={disabled}
                  aria-label={t('Remove reference {{name}}', {
                    name: referenceDisplayName(ref, t, language, props.assets),
                  })}
                  onClick={() =>
                    useImagePlaygroundStore.getState().removeReference(ref.id)
                  }
                >
                  <X size={14} />
                </Button>
              </div>
            ))}
          </div>
        )}
        {props.elements.error && (
          <p role='alert' className='studio-field-error'>
            {props.elements.error}
          </p>
        )}
      </section>
      <section className='compose-brief-section'>
        <div className='compose-section-heading'>
          <Label htmlFor='shoot-brief'>{t('Additional instructions')}</Label>
          <span>{t('Optional')}</span>
        </div>
        <Textarea
          id='shoot-brief'
          rows={3}
          maxLength={4000}
          disabled={disabled}
          value={props.state.brief}
          onChange={(e) => props.state.setBrief(e.target.value)}
          placeholder={t(
            'Add a setting, lighting or details for this combination.'
          )}
        />
      </section>
      <Collapsible
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        className='compose-character-options'
      >
        <CollapsibleTrigger
          aria-label={t('Character & framing options')}
          render={<Button variant='ghost' className='studio-details-trigger' />}
        >
          <span className='compose-details-label'>
            <strong>{t('Character & framing options')}</strong>
            <small>
              {fields.map((field) => (
                <span key={field.key}>
                  <span>{field.label}: </span>
                  {shootLabels[field.key][props.state.shoot[field.key]]}
                </span>
              ))}
            </small>
          </span>
          <ChevronDown
            size={15}
            className={detailsOpen ? 'is-expanded' : undefined}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className='shoot-setting-grid'>
            {fields.map((field) => (
              <div key={field.key}>
                <Label htmlFor={`shoot-${field.key}`}>{field.label}</Label>
                <NativeSelect
                  id={`shoot-${field.key}`}
                  disabled={disabled}
                  value={props.state.shoot[field.key]}
                  onChange={(e) =>
                    props.state.setShoot({
                      ...props.state.shoot,
                      [field.key]: e.target.value,
                    })
                  }
                >
                  {Object.entries(shootLabels[field.key]).map(
                    ([value, label]) => (
                      <NativeSelectOption key={value} value={value}>
                        {label}
                      </NativeSelectOption>
                    )
                  )}
                </NativeSelect>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </>
  )
}
