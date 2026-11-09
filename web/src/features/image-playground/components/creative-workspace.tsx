/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import {
  ArrowUpRight,
  FolderOpen,
  History,
  Images,
  Layers3,
  Loader2,
  Plus,
  Sparkles,
  UserRound,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { useCreativeModelSelection } from '../hooks/use-creative-model-selection'
import {
  useCreativeWorkspace,
  type StudioMode,
} from '../hooks/use-creative-workspace'
import { usePortraitElements } from '../hooks/use-portrait-elements'
import { useStudioCatalog } from '../hooks/use-studio-catalog'
import { useStudioGroups } from '../hooks/use-studio-groups'
import type { PortraitSlot } from '../lib/portrait-elements'
import { savedReferenceTitle } from '../lib/reference-names'
import { trackStudioEvent } from '../lib/studio-events'
import { useImagePlaygroundStore } from '../store'
import { CreativeSettings } from './creative-settings'
import { FashionReferencePicker } from './fashion-reference-picker'
import { FashionResults } from './fashion-results'
import { FashionReview } from './fashion-review'
import { FashionShootControls } from './fashion-shoot-controls'
import { FreeCreationControls } from './free-creation-controls'
import { StudioCostEstimate } from './studio-cost-estimate'

const StudioGallery = lazy(() =>
  import('./studio-gallery').then((m) => ({ default: m.StudioGallery }))
)
const modes: StudioMode[] = ['general', 'portrait']
export function CreativeWorkspace() {
  const { t, i18n } = useTranslation()
  const catalog = useStudioCatalog()
  const groups = useStudioGroups()
  const state = useCreativeWorkspace({
    catalog: catalog.data,
    groups: groups.data,
  })
  const parameters = useImagePlaygroundStore((s) => s.parameters)
  const elements = usePortraitElements(
    state.projectId,
    state.setSelectingElements
  )
  const [picker, setPicker] = useState<PortraitSlot | null>(null)
  const [review, setReview] = useState(false)
  const [history, setHistory] = useState(false)
  const [projects, setProjects] = useState(false)
  useEffect(
    () => trackStudioEvent({ action: 'page_opened', mode: 'general' }),
    []
  )
  useCreativeModelSelection(groups.data)
  const group = groups.data?.find((g) => g.id === parameters.group)
  const busy = state.executing || state.selectingElements || state.planning
  const openPicker = (role: PortraitSlot) => {
    if (busy) return
    state.switchMode('portrait')
    trackStudioEvent({ action: 'library_opened', mode: 'portrait', role })
    setPicker(role)
  }
  return (
    <div className='image-studio fashion-studio compose-studio'>
      <header className='compose-header'>
        <div className='compose-brand'>
          <span>
            <Layers3 size={21} strokeWidth={1.5} />
          </span>
          <h1>{t('Creative studio')}</h1>
        </div>
        <div className='compose-header-actions'>
          <Button
            variant='ghost'
            disabled={busy}
            onClick={() => openPicker('outfit')}
          >
            <Images size={16} />
            {t('Reference library')}
          </Button>
          <Button
            variant='ghost'
            disabled={busy}
            onClick={() => setProjects(true)}
          >
            <FolderOpen size={16} />
            {t('Saved projects')}
          </Button>
          <Button variant='ghost' onClick={() => setHistory(true)}>
            <History size={16} />
            {t('My creations')}
          </Button>
        </div>
      </header>
      <Tabs
        value={state.mode}
        onValueChange={(value) => {
          if (value === 'general' || value === 'portrait') {
            state.switchMode(value)
            setReview(false)
          }
        }}
        className='compose-mode-root'
      >
        <div className='compose-mode-bar'>
          <TabsList aria-label={t('Creation mode')}>
            <TabsTrigger value='general' disabled={busy}>
              <Sparkles size={16} />
              {t('Free creation')}
            </TabsTrigger>
            <TabsTrigger value='portrait' disabled={busy}>
              <UserRound size={16} />
              {t('Character composition')}
            </TabsTrigger>
          </TabsList>
          <span className='compose-mode-description'>
            {state.usesCharacter
              ? t(
                  'Choose the person, outfit and pose. Compose them into one image.'
                )
              : t('Start with words. Add an image when you need one.')}
          </span>
        </div>
        {groups.isError && (
          <div className='shoot-load-error' role='alert'>
            {t('Could not load image models.')}
            <Button
              size='sm'
              variant='outline'
              onClick={() => void groups.refetch()}
            >
              {t('Retry')}
            </Button>
          </div>
        )}
        {modes.map((mode) => (
          <TabsContent key={mode} value={mode}>
            {state.mode === mode && (
              <div className='compose-workspace'>
                <aside
                  className='compose-controls'
                  aria-label={t('Creation settings')}
                >
                  <div className='compose-panel-heading'>
                    <div>
                      <h2>
                        {state.usesCharacter
                          ? t('Your combination')
                          : t('Your idea')}
                      </h2>
                    </div>
                    <Button
                      variant='ghost'
                      size='sm'
                      disabled={busy}
                      onClick={() => {
                        state.clear()
                        setReview(false)
                      }}
                    >
                      <Plus size={14} />
                      {t('New project')}
                    </Button>
                  </div>
                  {state.usesCharacter ? (
                    <FashionShootControls
                      state={state}
                      elements={elements}
                      onChoose={openPicker}
                      assets={catalog.data ?? []}
                    />
                  ) : (
                    <FreeCreationControls state={state} />
                  )}
                  <div className='compose-settings'>
                    <CreativeSettings
                      group={group}
                      groups={groups.data}
                      disabled={busy}
                    />
                  </div>
                  <div className='compose-submit'>
                    <div className='compose-cost'>
                      <StudioCostEstimate group={group} />
                      <span>
                        {parameters.count} ×{' '}
                        {parameters.size === 'auto'
                          ? t('Auto')
                          : parameters.size.replace('x', ' × ')}
                      </span>
                    </div>
                    <Button
                      className='compose-generate'
                      disabled={!state.canGenerate}
                      onClick={() => void state.generateDirect()}
                    >
                      {state.executing ? (
                        <Loader2 size={17} className='animate-spin' />
                      ) : (
                        <ArrowUpRight size={18} />
                      )}
                      {state.usesCharacter
                        ? t('Generate combination')
                        : t('Generate image')}
                    </Button>
                    <div className='compose-assistant-entry'>
                      <Button
                        variant='ghost'
                        size='sm'
                        disabled={!state.canPlan || busy || state.inputPending}
                        onClick={async () => {
                          trackStudioEvent({
                            action: 'assistant_opened',
                            mode: state.mode,
                          })
                          await state.createPlan('manual')
                          setReview(true)
                        }}
                      >
                        <Sparkles size={14} />
                        {t('AI creative assistant')}
                      </Button>
                      <span>{t('Optional')}</span>
                    </div>
                    {state.submissionError && (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={state.reviewFailedSubmission}
                      >
                        {t('Review and try again')}
                      </Button>
                    )}
                    {state.inputPending && !state.submissionError && (
                      <p role='status' className='shoot-helper'>
                        {t(
                          'Your request has been submitted. Follow its progress on the right.'
                        )}
                      </p>
                    )}
                    {state.referencesUnsupported && (
                      <p role='status' className='studio-field-error'>
                        {t(
                          'Choose a model that supports all selected references.'
                        )}
                      </p>
                    )}
                    {state.invalidManagedReferences && (
                      <p className='studio-field-error'>
                        {t(
                          'Reselect outfits and poses from the current library before generating.'
                        )}
                      </p>
                    )}
                    {!group?.available && !groups.isLoading && (
                      <p className='shoot-helper'>
                        {t('No image model is available for this account.')}
                      </p>
                    )}
                    {state.saveStatus === 'failed' && (
                      <p role='status' className='studio-field-error'>
                        {t('Local save failed. Keep this tab open.')}
                      </p>
                    )}
                  </div>
                </aside>
                <FashionResults state={state} onChoose={openPicker} />
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
      <FashionReferencePicker
        role={picker}
        onRoleChange={setPicker}
        onClose={() => setPicker(null)}
        elements={elements}
        catalog={catalog}
      />
      <FashionReview
        state={state}
        group={group}
        open={review}
        onClose={() => setReview(false)}
      />
      <Dialog
        open={projects}
        onOpenChange={setProjects}
        title={t('Saved projects')}
        description={t('Projects and references are saved in this browser.')}
      >
        <div className='shoot-saved-list'>
          {state.projects.map((project) => (
            <Button
              key={project.id}
              variant='outline'
              disabled={busy}
              onClick={() => {
                state.restore(project)
                setProjects(false)
              }}
            >
              <FolderOpen size={18} />
              <span>
                {savedReferenceTitle(
                  project.title,
                  project.references.map((ref) => ({ ...ref, preview: '' })),
                  t,
                  i18n.resolvedLanguage || i18n.language,
                  catalog.data
                ) || t('Untitled project')}
              </span>
            </Button>
          ))}
          {!state.projects.length && (
            <p>{t('Your projects will appear here as you create.')}</p>
          )}
        </div>
      </Dialog>
      <Dialog
        open={history}
        onOpenChange={setHistory}
        title={t('My creations')}
        contentClassName='sm:max-w-6xl'
        contentHeight='75vh'
      >
        <div className='image-studio'>
          <Suspense fallback={<LoadingState />}>
            <StudioGallery />
          </Suspense>
        </div>
      </Dialog>
    </div>
  )
}
