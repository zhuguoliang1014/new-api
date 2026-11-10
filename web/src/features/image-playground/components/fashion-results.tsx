/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Check, Maximize2 } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { MOTION_TRANSITION } from '@/lib/motion'

import type { CreativeWorkspaceState } from '../hooks/use-creative-workspace'
import {
  portraitSlotLabels,
  referenceForSlot,
  type PortraitSlot,
} from '../lib/portrait-elements'
import { referenceDisplayName } from '../lib/reference-names'
import { useImagePlaygroundStore } from '../store'
import { CanvasPreparation } from './canvas-preparation'
import { ImageActions, ImageArtwork } from './studio-image'

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
  const reduce = useReducedMotion()
  const [taskSelection, setTaskSelection] = useState<{
    id: string
    latestId?: string
  }>()
  const [imageSelection, setImageSelection] = useState<{
    id: string
    latestId?: string
  }>()
  const [mode, setMode] = useState<'result' | 'side' | 'overlay'>('result')
  const [referenceId, setReferenceId] = useState<string>()
  const [opacity, setOpacity] = useState(50)
  const [preview, setPreview] = useState(false)
  const labels = portraitSlotLabels(t)
  const items = records
    .filter((r) => r.creativeContext?.projectId === props.state.projectId)
    .flatMap((record) => record.images.map((image) => ({ record, image })))
  const selected =
    imageSelection?.latestId === items[0]?.image.id
      ? (items.find((item) => item.image.id === imageSelection?.id) ?? items[0])
      : items[0]
  const projectJobs = jobs
    .filter((job) => job.creativeContext?.projectId === props.state.projectId)
    .sort((a, b) => b.startedAt - a.startedAt)
  const selectedTask =
    taskSelection?.latestId === projectJobs[0]?.id
      ? projectJobs.find((job) => job.id === taskSelection?.id)
      : undefined
  const latestResultAt = Math.max(
    0,
    ...items.map(({ record }) => record.createdAt)
  )
  const activeJob =
    selectedTask ?? projectJobs.find((job) => job.startedAt >= latestResultAt)
  const showResult = Boolean(selected && !activeJob)
  let canvasState = showResult ? 'ready' : 'idle'
  if (activeJob) canvasState = activeJob.error ? 'failed' : 'generating'
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
        {showResult && selected && (
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
      <div
        className='compose-canvas-card'
        data-state={canvasState}
        aria-busy={Boolean(activeJob && !activeJob.error)}
      >
        {projectJobs.length > 1 && (
          <div
            className='compose-canvas-tasks'
            role='group'
            aria-label={t('Task ID')}
          >
            {projectJobs.map((job, index) => (
              <Button
                key={job.id}
                variant='ghost'
                size='sm'
                aria-pressed={activeJob?.id === job.id}
                aria-label={`${t('Task ID')}: ${job.id}`}
                onClick={() =>
                  setTaskSelection({ id: job.id, latestId: projectJobs[0]?.id })
                }
              >
                {index + 1} ·{' '}
                {job.error ? t('Creation interrupted') : t('Creating...')}
              </Button>
            ))}
          </div>
        )}
        <AnimatePresence initial={false} mode='wait'>
          <motion.div
            key={
              showResult
                ? `result-${selected?.image.id}`
                : `preparation-${props.state.projectId}`
            }
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={reduce ? { duration: 0 } : MOTION_TRANSITION.default}
          >
            {showResult && selected ? (
              <div className='compose-canvas-result'>
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
                  <Button
                    variant='ghost'
                    size='sm'
                    onClick={() => setPreview(true)}
                  >
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
                      onClick={() =>
                        setImageSelection({
                          id: image.id,
                          latestId: items[0]?.image.id,
                        })
                      }
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
              </div>
            ) : (
              <CanvasPreparation
                portrait={props.state.usesCharacter}
                job={activeJob}
                selecting={props.state.selectingElements}
                onChoose={props.onChoose}
                onBrief={props.state.setBrief}
                onReuse={() => {
                  if (!activeJob) return
                  props.state.setBrief(activeJob.parameters.prompt)
                  useImagePlaygroundStore
                    .getState()
                    .setParameters(activeJob.parameters)
                  if (props.state.submissionError) {
                    props.state.reviewFailedSubmission()
                  }
                }}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
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
