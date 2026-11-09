/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Loader2, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import type { StudioGroup } from '../api'
import type { CreativeWorkspaceState } from '../hooks/use-creative-workspace'
import { useStudioAgentConfig } from '../hooks/use-studio-agent-config'
import { fashionShootLabels } from '../lib/fashion-shoot'
import { studioModelLabel } from '../lib/model-presentation'
import { portraitSlotLabels, type PortraitSlot } from '../lib/portrait-elements'
import { savedReferenceTitle } from '../lib/reference-names'
import { useImagePlaygroundStore } from '../store'
import { getImageModelOptions, imageParametersSchema } from '../types'
import { CreativePromptEditor } from './creative-prompt-editor'
import { StudioAgentSettings } from './studio-agent-settings'
import { StudioCostEstimate } from './studio-cost-estimate'

export function FashionReview(props: {
  state: CreativeWorkspaceState
  group?: StudioGroup
  open: boolean
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const state = props.state
  const references = useImagePlaygroundStore((s) => s.references)
  const parameters = useImagePlaygroundStore((s) => s.parameters)
  const jobs = useImagePlaygroundStore((s) => s.jobs)
  const [agentOpen, setAgentOpen] = useState(false)
  const agent = useStudioAgentConfig(agentOpen)
  const labels = portraitSlotLabels(t)
  const plan = state.plan?.value
  const shootLabels = fashionShootLabels(t)
  const options = getImageModelOptions(parameters.model)
  const canGenerate = Boolean(
    plan &&
    state.canPlan &&
    !state.stale &&
    !state.consumed &&
    !state.executing &&
    !state.planning &&
    props.group?.available &&
    props.group.models.includes(parameters.model) &&
    imageParametersSchema.safeParse({ ...parameters, prompt: plan.prompt })
      .success &&
    references.length <= options.maxReferences &&
    (references.length === 0 || options.supportsReferences) &&
    jobs.filter((j) => !j.error).length < 4 &&
    (!options.isMidjourney || [...plan.prompt].length <= 1023)
  )
  const refine = () => {
    if (!agent.config?.prompt) setAgentOpen(true)
    else void state.createPlan('assistant')
  }
  return (
    <>
      <Dialog
        open={props.open}
        onOpenChange={(open) => {
          if (!open) props.onClose()
        }}
        title={t('Review proposal')}
        description={t(
          'Check the references and direction. Generation starts only after you confirm.'
        )}
        contentClassName='shoot-review studio-review-polished sm:max-w-3xl'
        bodyClassName='studio-review-body'
        footerClassName='studio-review-footer-shell'
        footer={
          <div className='shoot-review-footer'>
            <StudioCostEstimate group={props.group} />
            <Button
              disabled={!canGenerate}
              onClick={async () => {
                await state.execute()
                props.onClose()
              }}
            >
              {state.executing ? (
                <Loader2 size={16} className='animate-spin' />
              ) : (
                <Sparkles size={16} />
              )}
              {t('Confirm & generate')}
            </Button>
          </div>
        }
      >
        {references.length > 0 && (
          <div className='shoot-review-references'>
            {references.map((r, index) => (
              <figure key={r.id}>
                <img
                  src={r.preview}
                  alt={labels[r.role as PortraitSlot] || t('Reference image')}
                />
                <figcaption>
                  {index + 1} · {labels[r.role as PortraitSlot] || t('Subject')}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        <div className='shoot-review-summary'>
          <h3>
            {savedReferenceTitle(
              plan?.title ?? t('Creative proposal'),
              references,
              t,
              i18n.resolvedLanguage || i18n.language
            )}
          </h3>
          <p>{plan?.summary}</p>
          {state.usesCharacter && (
            <dl className='shoot-review-choices'>
              <div>
                <dt>{t('Model build')}</dt>
                <dd>{shootLabels.body[state.shoot.body]}</dd>
              </div>
              <div>
                <dt>{t('Model stature')}</dt>
                <dd>{shootLabels.stature[state.shoot.stature]}</dd>
              </div>
              <div>
                <dt>{t('Framing')}</dt>
                <dd>{shootLabels.framing[state.shoot.framing]}</dd>
              </div>
            </dl>
          )}
          {references.length > 0 && (
            <p>{t('Each reference controls only its assigned role.')}</p>
          )}
          <div className='review-parameter-summary'>
            <span className='review-model-name'>
              {studioModelLabel(parameters.model, t)}
            </span>
            <span>
              {parameters.size === 'auto'
                ? t('Auto')
                : parameters.size.replace('x', ' × ')}
            </span>
            <span>{t('{{count}} image(s)', { count: parameters.count })}</span>
            {options.isGptImage && (
              <span>
                {parameters.format === 'auto'
                  ? t('Auto')
                  : parameters.format.toUpperCase()}
              </span>
            )}
          </div>
        </div>
        {plan && (
          <CreativePromptEditor
            value={plan.prompt}
            disabled={state.planning || state.executing || state.stale}
            limit={options.isMidjourney ? 1023 : 32000}
            onChange={(prompt) => state.editPlan({ ...plan, prompt })}
          />
        )}

        <div className='shoot-refine-row'>
          <Button
            variant='outline'
            size='sm'
            disabled={state.planning || state.executing || !state.canPlan}
            onClick={refine}
          >
            {state.planning ? (
              <Loader2 size={14} className='animate-spin' />
            ) : (
              <Sparkles size={14} />
            )}
            {t('Optimize with AI')}
          </Button>
          <span>{t('Optional · analysis is billed separately')}</span>
        </div>
        {state.stale && (
          <p role='status' className='studio-field-error'>
            {t(
              'The brief, references or settings changed. Create a new proposal before generating.'
            )}
            <Button
              variant='ghost'
              size='sm'
              onClick={() => void state.createPlan('manual')}
            >
              {t('Refresh proposal')}
            </Button>
          </p>
        )}
        {state.error && (
          <p role='alert' className='studio-field-error'>
            {state.error}
          </p>
        )}
        {options.isMidjourney && plan && [...plan.prompt].length > 1023 && (
          <p className='studio-field-error'>{t('Prompt is too long.')}</p>
        )}
        <p className='shoot-helper'>
          {t(
            'Only this confirmed image request will run. No automatic paid retries.'
          )}
        </p>
      </Dialog>
      <Dialog
        open={agentOpen}
        onOpenChange={setAgentOpen}
        title={t('Assistant settings')}
        description={t(
          'Choose a model with vision support to analyze references.'
        )}
      >
        <StudioAgentSettings
          state={agent}
          promptOnly
          onSaved={() => setAgentOpen(false)}
        />
      </Dialog>
    </>
  )
}
