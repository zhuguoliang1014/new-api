/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { nanoid } from 'nanoid'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { handleServerError } from '@/lib/handle-server-error'
import { useAuthStore } from '@/stores/auth-store'

import { getImageAuthScope, type StudioGroup } from '../api'
import {
  compileManualPrompt,
  creativeInputKey,
  defaultPosterSettings,
  type CreativePlan,
  type CreativeTask,
  type PosterSettings,
} from '../lib/creative'
import { requestCreativePlan } from '../lib/creative-plan-api'
import {
  listCreativeProjects,
  saveCreativeProject,
  type CreativeProject,
} from '../lib/creative-projects'
import {
  defaultFashionShoot,
  fashionShootInstruction,
  fashionShootSchema,
  type FashionShoot,
} from '../lib/fashion-shoot'
import { getImageBlob, validateReferenceFiles } from '../lib/images'
import {
  referenceForSlot,
  selectedElementInstructions,
  type PortraitAsset,
} from '../lib/portrait-elements'
import { referenceDisplayName } from '../lib/reference-names'
import { trackStudioEvent } from '../lib/studio-events'
import { useImagePlaygroundStore } from '../store'
import {
  getImageModelOptions,
  imageParametersSchema,
  type ImageReference,
  type ImageOutput,
  type ImageRecord,
} from '../types'
import { useImageStudio } from './use-image-studio'

export type StudioMode = 'general' | 'portrait'
type ModeDraft = {
  projectId: string
  brief: string
  shoot: FashionShoot
  plan: CreativeProject['plan']
  consumed: boolean
  submission?: { key: string; previousRecordIds: string[] }
  parentRecordId?: string
  references: Omit<ImageReference, 'preview'>[]
}

export function useCreativeWorkspace(options?: {
  catalog?: PortraitAsset[]
  groups?: StudioGroup[]
}) {
  const { t, i18n } = useTranslation()
  const studio = useImageStudio()
  const ownerId = useAuthStore((s) => s.auth.user?.id)
  const parameters = useImagePlaygroundStore((s) => s.parameters)
  const references = useImagePlaygroundStore((s) => s.references)
  const [mode, setMode] = useState<StudioMode>('general')
  const drafts = useRef<Partial<Record<StudioMode, ModeDraft>>>({})
  const submittedInput = useRef<{ key: string; previousRecordIds: string[] }>(
    undefined
  )
  const jobs = useImagePlaygroundStore((s) => s.jobs)
  const records = useImagePlaygroundStore((s) => s.records)
  const [ready, setReady] = useState(false)
  const [projectId, setProjectId] = useState(() => nanoid())
  const [brief, setBrief] = useState('')
  const [shoot, setShoot] = useState<FashionShoot>({ ...defaultFashionShoot })
  const [poster, setPoster] = useState<PosterSettings>(() => ({
    ...defaultPosterSettings,
    title: t('Nature takes shape'),
    kicker: t('BOTANICAL STUDIES / 01'),
    subtitle: t('A study of light, form & the everyday.'),
  }))
  const [parentRecordId, setParentRecordId] = useState<string>()
  const [plan, setPlan] = useState<CreativeProject['plan']>()
  const [planning, setPlanning] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [selectingElements, setSelectingElements] = useState(false)
  const [consumed, setConsumed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projects, setProjects] = useState<CreativeProject[]>([])
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'failed'
  >('idle')
  const [mobilePanel, setMobilePanel] = useState<
    'canvas' | 'assets' | 'assistant'
  >('canvas')
  const planningController = useRef<AbortController | null>(null)
  const submitLock = useRef(false)
  const continuationController = useRef<AbortController | null>(null)
  const writes = useRef(Promise.resolve())
  const saveRevision = useRef(0)
  const pendingSave = useRef<(() => void) | null>(null)
  const usesCharacter = mode === 'portrait'
  const taskType: CreativeTask = mode
  const invalidManagedReferences = references.some(
    (r) =>
      (r.role === 'pose' || r.role === 'outfit') &&
      !options?.catalog?.some(
        (a) =>
          a.role === r.role &&
          a.id === r.assetId &&
          (a.role !== 'pose' ||
            a.views.some(
              (v) =>
                v.id === r.assetView ||
                (v.depth && `${v.id}:depth` === r.assetView)
            ))
      )
  )
  const inputKey = creativeInputKey(
    taskType,
    JSON.stringify({
      brief,
      shoot: usesCharacter ? shoot : undefined,
    }),
    parameters,
    references
  )
  const currentInput = useRef(inputKey)
  currentInput.current = inputKey
  const stale = Boolean(plan && plan.inputKey !== inputKey)
  const canPlan =
    !selectingElements &&
    !invalidManagedReferences &&
    Boolean(brief.trim() || references.length)
  const group = options?.groups?.find((g) => g.id === parameters.group)
  const modelOptions = getImageModelOptions(parameters.model)
  const referencesUnsupported =
    references.length > modelOptions.maxReferences ||
    (references.length > 0 && !modelOptions.supportsReferences)
  const requestBrief =
    brief.trim() || t('Create an image from the selected references.')
  const effectiveBrief = usesCharacter
    ? `${requestBrief}\n${fashionShootInstruction(shoot, Boolean(referenceForSlot(references, 'scene')))}`
    : requestBrief
  const combinationTitle = ['outfit', 'pose']
    .map((role) => {
      const ref = referenceForSlot(references, role as 'outfit' | 'pose')
      return ref
        ? referenceDisplayName(
            ref,
            t,
            i18n.resolvedLanguage || i18n.language,
            options?.catalog
          )
        : ''
    })
    .filter(Boolean)
    .join(' · ')
    .slice(0, 120)

  useEffect(() => {
    useImagePlaygroundStore.getState().clearDraft()
    setReady(true)
  }, [])

  useEffect(
    () => () => {
      pendingSave.current?.()
      planningController.current?.abort()
      continuationController.current?.abort()
    },
    []
  )

  useEffect(() => {
    if (!ownerId) return
    let active = true
    listCreativeProjects(ownerId)
      .then((items) => {
        if (active) setProjects(items)
      })
      .catch(() => {
        if (active) setSaveStatus('failed')
      })
    return () => {
      active = false
    }
  }, [ownerId])

  useEffect(() => {
    if (!ready || !ownerId || (!brief.trim() && !references.length && !plan)) {
      return
    }
    const revision = ++saveRevision.current
    const scope = getImageAuthScope()
    const project: CreativeProject = {
      version: 1,
      id: projectId,
      ownerId,
      taskType,
      brief,
      parameters,
      poster,
      shoot,
      parentRecordId,
      plan,
      title: plan?.value.title ?? brief.trim().slice(0, 36),
      updatedAt: Date.now(),
      references: references.map((r) => ({
        id: r.id,
        file: r.file,
        role: r.role ?? 'subject',
        assetTitle: r.assetTitle,
        assetId: r.assetId,
        assetView: r.assetView,
        assetRole: r.assetRole,
        assetInstruction: r.assetInstruction,
      })),
    }
    setSaveStatus('saving')
    let queued = false
    const persist = () => {
      if (queued) return
      queued = true
      writes.current = writes.current
        .catch(() => undefined)
        .then(async () => {
          await saveCreativeProject(project)
          if (getImageAuthScope() !== scope) return
          setProjects((items) => [
            project,
            ...items.filter((item) => item.id !== project.id),
          ])
          if (saveRevision.current === revision) setSaveStatus('saved')
        })
        .catch(() => {
          if (
            getImageAuthScope() === scope &&
            saveRevision.current === revision
          ) {
            setSaveStatus('failed')
          }
        })
    }
    pendingSave.current = persist
    const timer = window.setTimeout(persist, 600)
    return () => window.clearTimeout(timer)
  }, [
    ready,
    ownerId,
    projectId,
    taskType,
    brief,
    parameters,
    poster,
    shoot,
    parentRecordId,
    plan,
    references,
  ])

  const switchMode = (next: StudioMode) => {
    if (next === mode || executing || selectingElements || planning) return
    pendingSave.current?.()
    pendingSave.current = null
    drafts.current[mode] = {
      projectId,
      brief,
      shoot,
      plan,
      consumed,
      submission: submittedInput.current,
      parentRecordId,
      references: references.map(({ preview: _preview, ...ref }) => ref),
    }
    const draft = drafts.current[next]
    planningController.current?.abort()
    continuationController.current?.abort()
    useImagePlaygroundStore.getState().clearDraft()
    if (draft) {
      useImagePlaygroundStore.setState({
        references: draft.references.map((ref) => ({
          ...ref,
          preview: URL.createObjectURL(ref.file),
        })),
      })
    }
    trackStudioEvent({ action: 'mode_selected', mode: next })
    setMode(next)
    setProjectId(draft?.projectId ?? nanoid())
    setBrief(draft?.brief ?? '')
    setShoot(draft?.shoot ?? { ...defaultFashionShoot })
    setPlan(draft?.plan)
    setParentRecordId(draft?.parentRecordId)
    setConsumed(draft?.consumed ?? false)
    submittedInput.current = draft?.submission
    setError(null)
    saveRevision.current++
    setSaveStatus('idle')
  }

  const clear = () => {
    pendingSave.current?.()
    planningController.current?.abort()
    continuationController.current?.abort()
    useImagePlaygroundStore.getState().clearDraft()
    delete drafts.current[mode]
    submittedInput.current = undefined
    setProjectId(nanoid())
    setBrief('')
    setShoot({ ...defaultFashionShoot })
    setPlan(undefined)
    setParentRecordId(undefined)
    setConsumed(false)
    setError(null)
    saveRevision.current++
    setSaveStatus('idle')
  }

  const manualPlan = (): CreativePlan => ({
    title: usesCharacter
      ? brief.trim().slice(0, 36) || combinationTitle || t('Creative proposal')
      : effectiveBrief.slice(0, 36),
    summary: usesCharacter
      ? t('Combine your selected references with the creative brief.')
      : t('A manual proposal using your brief and reference roles.'),
    prompt: compileManualPrompt(taskType, effectiveBrief, references),
    preserve: [],
    steps: [
      t('Combine the selected references and composition in one generation.'),
    ],
  })
  const generationPlan = plan && !stale ? plan.value : manualPlan()
  const inputPending =
    consumed &&
    !stale &&
    !records.some(
      (record) =>
        record.creativeContext?.projectId === projectId &&
        !(plan?.previousRecordIds ?? []).includes(record.id)
    )
  const validGeneration = (value: CreativePlan) =>
    Boolean(
      canPlan &&
      !executing &&
      !planning &&
      !selectingElements &&
      group?.available &&
      group.models.includes(parameters.model) &&
      imageParametersSchema.safeParse({ ...parameters, prompt: value.prompt })
        .success &&
      references.length <= modelOptions.maxReferences &&
      (!references.length || modelOptions.supportsReferences) &&
      jobs.filter((job) => !job.error).length < 4 &&
      (!modelOptions.isMidjourney || [...value.prompt].length <= 1023)
    )
  const submissionError =
    inputPending &&
    jobs.find(
      (job) =>
        job.parameters.prompt === plan?.value.prompt &&
        job.parameters.model === parameters.model
    )?.error
  const canGenerate = validGeneration(generationPlan) && !inputPending

  const createPlan = async (source: 'assistant' | 'manual') => {
    if (!canPlan || planning) return
    const scope = getImageAuthScope()
    const controller = new AbortController()
    planningController.current?.abort()
    planningController.current = controller
    setPlanning(true)
    setError(null)
    const key = inputKey
    try {
      let value: CreativePlan
      if (source === 'assistant') {
        value = await requestCreativePlan(
          {
            brief:
              `${effectiveBrief}\n${selectedElementInstructions(references)}`.trim(),
            taskType,
            language: i18n.resolvedLanguage || i18n.language,
            references,
          },
          controller.signal
        )
      } else {
        value = manualPlan()
      }
      if (
        controller.signal.aborted ||
        getImageAuthScope() !== scope ||
        currentInput.current !== key
      ) {
        return
      }
      setPlan({ value, inputKey: key, source })
      setConsumed(false)
    } catch (e) {
      if (!controller.signal.aborted && getImageAuthScope() === scope) {
        setError(t('Could not create a proposal. Your draft is kept.'))
        handleServerError(e)
      }
    } finally {
      if (planningController.current === controller) setPlanning(false)
    }
  }

  const submitPlan = async (
    value: CreativePlan,
    source: 'assistant' | 'manual'
  ) => {
    if (!validGeneration(value) || submitLock.current) return
    // Lock synchronously before React rerenders, including double clicks while a submission is pending.
    if (
      submittedInput.current?.key === inputKey &&
      !useImagePlaygroundStore
        .getState()
        .records.some(
          (record) =>
            record.creativeContext?.projectId === projectId &&
            !submittedInput.current?.previousRecordIds.includes(record.id)
        )
    ) {
      return
    }
    submitLock.current = true
    const previousRecordIds = records.map((record) => record.id)
    submittedInput.current = { key: inputKey, previousRecordIds }
    const scope = getImageAuthScope()
    setExecuting(true)
    setConsumed(true)
    setPlan({ value, inputKey, source, submitted: true, previousRecordIds })
    useImagePlaygroundStore.setState({
      creativeContext: {
        projectId,
        taskType,
        brief,
        planTitle: value.title,
        parentRecordId,
        referenceRoles: references.map((r) => r.role ?? 'subject'),
      },
      selectedStyleId: null,
    })
    try {
      await studio.generateAsync({ ...parameters, prompt: value.prompt })
      if (scope === getImageAuthScope()) setMobilePanel('canvas')
    } finally {
      submitLock.current = false
      if (scope === getImageAuthScope()) setExecuting(false)
    }
  }
  const execute = async () => {
    if (!plan || stale || consumed) return
    await submitPlan(plan.value, plan.source)
  }
  const generateDirect = async () => {
    if (!canGenerate) return
    await submitPlan(generationPlan, plan && !stale ? plan.source : 'manual')
  }

  const restore = (project: CreativeProject) => {
    if (project.ownerId !== ownerId) return
    pendingSave.current?.()
    planningController.current?.abort()
    continuationController.current?.abort()
    try {
      validateReferenceFiles(
        project.references.map((r) => r.file),
        getImageModelOptions(project.parameters.model).maxReferences
      )
    } catch (e) {
      handleServerError(e)
      return
    }
    const restored = project.references.map((r) => ({
      ...r,
      preview: URL.createObjectURL(r.file),
    }))
    useImagePlaygroundStore.getState().clearDraft()
    useImagePlaygroundStore.getState().setParameters(project.parameters)
    useImagePlaygroundStore.getState().replaceReferences(restored)
    setMode(project.taskType === 'portrait' ? 'portrait' : 'general')
    submittedInput.current = project.plan?.submitted
      ? {
          key: project.plan.inputKey,
          previousRecordIds: project.plan.previousRecordIds ?? [],
        }
      : undefined
    setProjectId(project.id)
    setBrief(project.brief)
    setPoster(project.poster)
    const restoredShoot = fashionShootSchema.safeParse(project.shoot)
    setShoot(
      restoredShoot.success ? restoredShoot.data : { ...defaultFashionShoot }
    )
    setParentRecordId(project.parentRecordId)
    setPlan(project.plan)
    setConsumed(Boolean(project.plan?.submitted))
    setError(null)
    setMobilePanel('assistant')
  }

  const continueFrom = async (record: ImageRecord, image: ImageOutput) => {
    const scope = getImageAuthScope()
    const controller = new AbortController()
    continuationController.current?.abort()
    continuationController.current = controller
    try {
      const blob = await getImageBlob(image.src, controller.signal)
      if (scope !== getImageAuthScope() || controller.signal.aborted) return
      const file = new File(
        [blob],
        `previous-version.${blob.type.split('/')[1]}`,
        { type: blob.type }
      )
      const store = useImagePlaygroundStore.getState()
      store.addReferences([file])
      const added = useImagePlaygroundStore.getState().references.at(-1)
      if (added) store.setReferenceRole(added.id, 'subject')
      setParentRecordId(record.id)
      setBrief('')
      setPlan(undefined)
      setConsumed(false)
      setMobilePanel('assistant')
    } catch (e) {
      if (!controller.signal.aborted) handleServerError(e)
    }
  }

  return {
    mode,
    switchMode,
    canGenerate,
    inputPending,
    submissionError,
    reviewFailedSubmission: () => {
      if (!submissionError || executing) return
      submittedInput.current = undefined
      setConsumed(false)
      setPlan(undefined)
    },
    generateDirect,
    projectId,
    taskType,
    brief,
    canPlan,
    usesCharacter,
    invalidManagedReferences,
    referencesUnsupported,
    shoot,
    setShoot,
    setBrief,
    poster,
    setPoster,
    plan,
    planning,
    executing,
    selectingElements,
    setSelectingElements,
    consumed,
    stale,
    error,
    saveStatus,
    projects,
    parentRecordId,
    mobilePanel,
    setMobilePanel,
    createPlan,
    execute,
    clear,
    restore,
    continueFrom,
    editPlan: (value: CreativePlan) => {
      setPlan((p) => (p ? { ...p, value, submitted: false } : p))
      setConsumed(false)
    },
  }
}

export type CreativeWorkspaceState = ReturnType<typeof useCreativeWorkspace>
