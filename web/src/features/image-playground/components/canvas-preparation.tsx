/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Image as ImageIcon, Plus } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { MOTION_TRANSITION } from '@/lib/motion'

import { portraitSlotLabels, type PortraitSlot } from '../lib/portrait-elements'
import { useImagePlaygroundStore } from '../store'
import type { ImageJob } from '../types'
import { GenerationProgress } from './generation-progress'
import { ReferenceSlotArtwork } from './reference-slot-artwork'
import { ReferenceThumbnail } from './reference-thumbnail'
import { StudioImageHoverPreview } from './studio-image-hover-preview'

function useReferencePreviews(job?: ImageJob) {
  const [previews, setPreviews] = useState<
    { id: string; role?: string; preview: string }[]
  >([])
  const files = job?.referenceFiles
  useEffect(() => {
    const items = (files ?? []).map((reference) => ({
      id: reference.id,
      role: reference.role,
      preview: URL.createObjectURL(reference.file),
    }))
    setPreviews(items)
    return () => {
      for (const item of items) URL.revokeObjectURL(item.preview)
    }
  }, [files])
  return previews
}

export function CanvasPreparation(props: {
  portrait: boolean
  job?: ImageJob
  selecting: boolean
  onChoose: (role: PortraitSlot) => void
  onBrief: (brief: string) => void
  onReuse: () => void
}) {
  const { t } = useTranslation()
  const currentReferences = useImagePlaygroundStore((state) => state.references)
  const taskReferences = useReferencePreviews(props.job)
  const references = props.job ? taskReferences : currentReferences
  const labels = portraitSlotLabels(t)
  const reduce = useReducedMotion()
  const working = Boolean(props.job && !props.job.error)
  return (
    <div
      className={`compose-canvas-preparation${props.job ? ' has-task' : ''}${working ? ' is-working' : ''}`}
    >
      <motion.div
        layout='position'
        transition={reduce ? { duration: 0 } : MOTION_TRANSITION.slow}
        className='compose-canvas-reference-stage'
      >
        {props.portrait ? (
          <div
            className='compose-combination-preview'
            aria-label={t('Combination preview')}
          >
            {(['identity', 'outfit', 'pose'] as const).map((role, index) => {
              const reference = references.find((item) => item.role === role)
              return (
                <div className='compose-preview-item' key={role}>
                  {index > 0 && (
                    <Plus className='compose-preview-plus' size={17} />
                  )}
                  <StudioImageHoverPreview
                    src={reference?.preview ?? ''}
                    label={labels[role]}
                    enabled={Boolean(reference) && !props.job}
                    large
                    side='left'
                    trigger={
                      <Button
                        variant='outline'
                        disabled={Boolean(props.job) || props.selecting}
                        aria-label={t('Choose {{element}}', {
                          element: labels[role],
                        })}
                        onClick={() => props.onChoose(role)}
                      >
                        {reference ? (
                          <ReferenceThumbnail
                            src={reference.preview}
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
            })}
          </div>
        ) : (
          <div className='compose-empty-art' aria-hidden='true'>
            <span />
            <span />
            <div>
              <ImageIcon size={42} strokeWidth={1} />
            </div>
          </div>
        )}
      </motion.div>
      <div className='compose-canvas-status-slot'>
        <AnimatePresence initial={false} mode='wait'>
          {props.job ? (
            <motion.div
              key='progress'
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={reduce ? { duration: 0 } : MOTION_TRANSITION.default}
            >
              <GenerationProgress
                job={props.job}
                embedded
                promptLabel={t('Creative proposal')}
                onReuse={props.onReuse}
              />
            </motion.div>
          ) : (
            <motion.div
              key='idle'
              className='compose-canvas-introduction'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -6 }}
              transition={reduce ? { duration: 0 } : MOTION_TRANSITION.fast}
            >
              <h3>
                {props.portrait
                  ? t('See your references come together.')
                  : t('Give your idea a picture.')}
              </h3>
              <p>
                {props.portrait
                  ? t(
                      'Choose your references on the left. Your generated combination will appear here.'
                    )
                  : t(
                      'Describe what you imagine, or add a photo to edit. Your image will appear here.'
                    )}
              </p>
              {!props.portrait && (
                <div className='compose-prompt-examples'>
                  {[
                    t('A quiet coastline in soft morning light'),
                    t('A perfume bottle on a sunlit stone table'),
                    t('A playful illustrated poster for a coffee shop'),
                  ].map((brief) => (
                    <Button
                      key={brief}
                      variant='outline'
                      onClick={() => props.onBrief(brief)}
                    >
                      {brief}
                    </Button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
