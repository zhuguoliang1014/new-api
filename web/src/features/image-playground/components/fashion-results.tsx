/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  Check,
  ArrowUpRight,
  Image as ImageIcon,
  Maximize2,
  Plus,
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'

import type { CreativeWorkspaceState } from '../hooks/use-creative-workspace'
import {
  portraitSlotLabels,
  referenceForSlot,
  type PortraitSlot,
} from '../lib/portrait-elements'
import { referenceDisplayName } from '../lib/reference-names'
import { useImagePlaygroundStore } from '../store'
import { GenerationProgress } from './generation-progress'
import { ReferenceSlotArtwork } from './reference-slot-artwork'
import { ReferenceThumbnail } from './reference-thumbnail'
import { ImageActions, ImageArtwork } from './studio-image'
import { StudioImageHoverPreview } from './studio-image-hover-preview'

const StudioPreview = lazy(() =>
  import('./studio-preview').then((m) => ({ default: m.StudioPreview }))
)
export function FashionResults(props: {
  state: CreativeWorkspaceState
  onChoose: (role: PortraitSlot) => void
}) {
  const { t, i18n } = useTranslation()
  const records = useImagePlaygroundStore((s) => s.records)
  const jobs = useImagePlaygroundStore((s) => s.jobs)
  const references = useImagePlaygroundStore((s) => s.references)
  const taskSyncError = useImagePlaygroundStore((s) => s.taskSyncError)
  const [imageId, setImageId] = useState<string>()
  const [mode, setMode] = useState<'result' | 'side' | 'overlay'>('result')
  const [referenceId, setReferenceId] = useState<string>()
  const [opacity, setOpacity] = useState(50)
  const [preview, setPreview] = useState(false)
  const labels = portraitSlotLabels(t)
  const items = records
    .filter((r) => r.creativeContext?.projectId === props.state.projectId)
    .flatMap((record) => record.images.map((image) => ({ record, image })))
  const selected = items.find((item) => item.image.id === imageId) ?? items[0]
  const reference =
    references.find((r) => r.id === referenceId) ??
    referenceForSlot(references, 'outfit') ??
    references[0]
  const showComparison = mode !== 'result' && reference && selected
  const modes = {
    result: t('Result only'),
    side: t('Side by side'),
    overlay: t('Overlay comparison'),
  }
  return (
    <section className='shoot-results' aria-label={t('Your creation')}>
      <div className='shoot-result-heading'>
        <div>
          <span className='shoot-eyebrow'>{t('YOUR CANVAS')}</span>
          <h2>{t('Your creation')}</h2>
        </div>
        {selected && (
          <div
            className='shoot-result-modes'
            role='group'
            aria-label={t('Preview mode')}
          >
            {Object.entries(modes).map(([value, label]) => (
              <Button
                key={value}
                variant='ghost'
                size='sm'
                disabled={!selected || (value !== 'result' && !reference)}
                aria-pressed={mode === value}
                onClick={() => setMode(value as typeof mode)}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {taskSyncError && (
        <p role='status' className='studio-storage-warning'>
          {t('Connection interrupted. Tasks continue on the server.')}
        </p>
      )}
      {jobs.length > 0 && (
        <div className='shoot-task-list'>
          {jobs.map((job) => (
            <GenerationProgress
              key={job.id}
              job={job}
              promptLabel={t('Creative proposal')}
            />
          ))}
        </div>
      )}
      {selected ? (
        <>
          {props.state.stale && (
            <p className='shoot-helper' role='status'>
              {t(
                'The combination has changed. The photo below is from the previous shoot.'
              )}
            </p>
          )}
          {showComparison && (
            <div className='shoot-comparison-controls'>
              <Label htmlFor='shoot-compare'>{t('Compare with')}</Label>
              <NativeSelect
                id='shoot-compare'
                value={reference.id}
                onChange={(e) => setReferenceId(e.target.value)}
              >
                {references.map((r, index) => (
                  <NativeSelectOption key={r.id} value={r.id}>
                    {labels[r.role as PortraitSlot] ||
                      t('Reference {{index}}', { index: index + 1 })}{' '}
                    ·{' '}
                    {referenceDisplayName(
                      r,
                      t,
                      i18n.resolvedLanguage || i18n.language
                    )}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {mode === 'overlay' && (
                <>
                  <Label htmlFor='shoot-opacity'>
                    {t('Reference opacity')}
                  </Label>
                  <Input
                    id='shoot-opacity'
                    type='range'
                    min={0}
                    max={100}
                    value={opacity}
                    onChange={(e) => setOpacity(Number(e.target.value))}
                  />
                </>
              )}
            </div>
          )}
          <div
            className={`shoot-result-stage${showComparison ? ` is-${mode}` : ''}`}
          >
            {showComparison && mode === 'side' && (
              <figure>
                <img src={reference.preview} alt={t('Reference image')} />
                <figcaption>{t('Reference image')}</figcaption>
              </figure>
            )}
            <figure className='shoot-output-figure'>
              <ImageArtwork
                image={selected.image}
                requestedSize={selected.record.parameters.size}
                onPreview={() => setPreview(true)}
              />
              {showComparison && mode === 'overlay' && (
                <img
                  className='shoot-overlay-reference'
                  src={reference.preview}
                  alt={t('Reference image')}
                  style={{ opacity: opacity / 100 }}
                />
              )}
              <figcaption>{t('Generated photo')}</figcaption>
            </figure>
          </div>
          <div className='shoot-result-actions'>
            <ImageActions
              image={selected.image}
              record={selected.record}
              continueLabel={
                props.state.usesCharacter
                  ? t('Change pose & shoot again')
                  : t('Continue editing')
              }
              onContinue={async () => {
                if (props.state.usesCharacter) props.onChoose('pose')
                else {
                  await props.state.continueFrom(
                    selected.record,
                    selected.image
                  )
                }
              }}
            />
            <Button variant='ghost' size='sm' onClick={() => setPreview(true)}>
              <Maximize2 size={14} />
              {t('Preview')}
            </Button>
          </div>
          <div
            className='shoot-version-list'
            role='group'
            aria-label={t('Project versions')}
          >
            {items.map(({ image }, index) => (
              <Button
                key={image.id}
                variant='ghost'
                aria-label={t('Select version {{index}}', {
                  index: items.length - index,
                })}
                aria-pressed={selected.image.id === image.id}
                onClick={() => setImageId(image.id)}
              >
                <img src={image.previewSrc || image.src} alt='' />
                <span>{items.length - index}</span>
              </Button>
            ))}
          </div>
          <div className='shoot-quality-note'>
            <Check size={15} />
            <p>
              {t(
                'Compare the details with your references before using the result.'
              )}
            </p>
          </div>
          <p className='shoot-helper'>
            {t(
              'Download originals to keep them. Server results expire after 10 hours; local history keeps the latest 30 creations.'
            )}
          </p>
        </>
      ) : (
        <div
          className={`compose-empty ${props.state.usesCharacter ? 'compose-empty-portrait' : 'compose-empty-free'}`}
        >
          {props.state.usesCharacter ? (
            <>
              <div
                className='compose-combination-preview'
                aria-label={t('Combination preview')}
              >
                {(['identity', 'outfit', 'pose'] as const).map(
                  (role, index) => {
                    const ref = referenceForSlot(references, role)
                    return (
                      <div key={role} className='compose-preview-item'>
                        {index > 0 && (
                          <Plus className='compose-preview-plus' size={17} />
                        )}
                        <StudioImageHoverPreview
                          src={ref?.preview ?? ''}
                          label={labels[role]}
                          enabled={Boolean(ref)}
                          large
                          side='left'
                          trigger={
                            <Button
                              variant='outline'
                              disabled={
                                props.state.executing ||
                                props.state.selectingElements
                              }
                              aria-label={t('Choose {{element}}', {
                                element: labels[role],
                              })}
                              onClick={() => props.onChoose(role)}
                            >
                              {ref ? (
                                <ReferenceThumbnail
                                  src={ref.preview}
                                  alt={labels[role]}
                                />
                              ) : (
                                <ReferenceSlotArtwork role={role} />
                              )}
                            </Button>
                          }
                        />
                        <span>{labels[role]}</span>
                      </div>
                    )
                  }
                )}
              </div>
              <h3>{t('See your references come together.')}</h3>
              <p>
                {t(
                  'Choose your references on the left. Your generated combination will appear here.'
                )}
              </p>
            </>
          ) : (
            <>
              <div className='compose-empty-art' aria-hidden='true'>
                <span />
                <span />
                <div>
                  <ImageIcon size={42} strokeWidth={1} />
                </div>
              </div>
              <h3>{t('Give your idea a picture.')}</h3>
              <p>
                {t(
                  'Describe what you imagine, or add a photo to edit. Your image will appear here.'
                )}
              </p>
              <div className='compose-prompt-examples'>
                {[
                  t('A quiet coastline in soft morning light'),
                  t('A perfume bottle on a sunlit stone table'),
                  t('A playful illustrated poster for a coffee shop'),
                ].map((prompt) => (
                  <Button
                    key={prompt}
                    variant='outline'
                    disabled={props.state.executing}
                    onClick={() => props.state.setBrief(prompt)}
                  >
                    {prompt}
                    <ArrowUpRight size={14} aria-hidden='true' />
                  </Button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {preview && selected && (
        <Suspense fallback={<LoadingState />}>
          <StudioPreview
            images={[selected.image]}
            index={0}
            onIndexChange={() => undefined}
            onClose={() => setPreview(false)}
            requestedSize={selected.record.parameters.size}
            prompt={selected.record.parameters.prompt}
            footer={() => (
              <ImageActions
                image={selected.image}
                record={selected.record}
                continueLabel={
                  props.state.usesCharacter
                    ? t('Change pose & shoot again')
                    : t('Continue editing')
                }
                onContinue={async () => {
                  setPreview(false)
                  if (props.state.usesCharacter) props.onChoose('pose')
                  else {
                    await props.state.continueFrom(
                      selected.record,
                      selected.image
                    )
                  }
                }}
              />
            )}
          />
        </Suspense>
      )}
    </section>
  )
}
