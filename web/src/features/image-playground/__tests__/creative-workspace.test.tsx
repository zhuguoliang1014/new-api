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
import { readFileSync } from 'node:fs'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getPricing } from '@/features/pricing/api'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import {
  createStudioTask,
  getPlaygroundAgentConfig,
  getStudioGroups,
  listStudioTasks,
} from '../api'
import { studioCatalogSchema } from '../hooks/use-studio-catalog'
import { ImagePlayground } from '../index'
import {
  listCreativeProjects,
  saveCreativeProject,
} from '../lib/creative-projects'
import { readImageHistory } from '../lib/history'
import {
  readStudioModelPreference,
  saveStudioModelPreference,
} from '../lib/model-preference'
import { useImagePlaygroundStore } from '../store'
import { defaultImageParameters } from '../types'

vi.mock('../lib/studio-events', () => ({ trackStudioEvent: vi.fn() }))

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  getStatus: vi.fn().mockResolvedValue({ price: 1, quota_per_unit: 500000 }),
}))
vi.mock('@/features/pricing/api', () => ({ getPricing: vi.fn() }))
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  getStudioGroups: vi.fn(),
  getPlaygroundAgentConfig: vi.fn(),
  listStudioTasks: vi.fn(),
  createStudioTask: vi.fn(),
}))
vi.mock('../lib/history', () => ({
  readImageHistory: vi.fn(),
  saveImageRecord: vi.fn(),
  deleteImageRecord: vi.fn(),
}))
vi.mock('../lib/creative-projects', async (original) => ({
  ...(await original<typeof import('../lib/creative-projects')>()),
  listCreativeProjects: vi.fn(),
  saveCreativeProject: vi.fn(),
}))
let client: QueryClient
const proposal = {
  title: 'Glass in sunlight',
  summary: 'Natural side light and a pale backdrop.',
  prompt: 'Olive glass bottle, natural light',
  preserve: ['Bottle shape'],
  steps: ['Place the bottle in side light.'],
}
const catalog = JSON.parse(
  readFileSync('../controller/resources/studio-reference-catalog.json', 'utf8')
)
beforeEach(() => {
  localStorage.clear()
  vi.spyOn(api, 'get').mockResolvedValue({ data: catalog })
  vi.mocked(listCreativeProjects).mockResolvedValue([])
  vi.mocked(saveCreativeProject).mockResolvedValue(undefined)
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      ({
        ok: true,
        blob: async () => new Blob(['image'], { type: 'image/webp' }),
      }) as Response
  )

  useImagePlaygroundStore.getState().setScope(null)
  useAuthStore.setState((s) => ({
    auth: {
      ...s.auth,
      user: { id: 1, username: 'artist', role: 1 },
      session: {
        sid: 'creative-session',
        current: true,
        login_method: 'password',
        ip: '',
        user_agent: '',
        created_at: 0,
        last_active_at: 0,
        expires_at: 9999999999,
      },
    },
  }))
  vi.mocked(getStudioGroups).mockResolvedValue([
    {
      id: 'basic',
      name: 'Basic',
      description: '',
      ratio: 1,
      models: ['gpt-image-2.5-flare-basic', 'gpt-image-2-native'],
      max_resolution: 4,
      size_mode: 'upscale',
      available: true,
    },
  ])
  vi.mocked(getPlaygroundAgentConfig).mockResolvedValue({
    prompt: { token_id: 1, model: 'vision-model' },
    image: null,
  })
  vi.mocked(getPricing).mockResolvedValue({
    success: true,
    data: [],
    vendors: [],
    group_ratio: {},
    usable_group: {},
    supported_endpoint: {},
    auto_groups: [],
  })
  vi.mocked(readImageHistory).mockResolvedValue([])
  vi.mocked(listStudioTasks).mockResolvedValue([])
  vi.mocked(createStudioTask).mockImplementation(
    async (id, _parameters, _references, metadata) => ({
      id,
      metadata,
      status: 'queued',
      created_at: Date.now(),
      expires_at: 9999999999,
      images: [],
      downloaded_bytes: 0,
      total_bytes: 0,
    })
  )
  vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: proposal },
  })
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})
afterEach(() => {
  client.clear()
  useImagePlaygroundStore.getState().setScope(null)
})
async function openStudio() {
  render(
    <QueryClientProvider client={client}>
      <ImagePlayground />
    </QueryClientProvider>
  )
  await waitFor(() => expect(getStudioGroups).toHaveBeenCalled())
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().parameters.model).toBe(
      'gpt-image-2.5-flare-basic'
    )
  )
  return userEvent.setup()
}

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  role: string,
  name: string,
  angle?: string
) {
  await user.click(screen.getByRole('tab', { name: 'Character composition' }))
  await user.click(
    within(
      screen.getByRole('complementary', { name: 'Creation settings' })
    ).getByRole('button', { name: `Choose ${role}` })
  )
  const picker = await screen.findByRole('dialog', { name: `Choose ${role}` })
  if (angle) {
    await user.click(
      within(
        within(picker).getByRole('group', { name: `Camera angles for ${name}` })
      ).getByRole('button', { name: angle })
    )
  }
  await user.click(
    within(picker).getByRole('button', { name: `Select ${name}` })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: `Choose ${role}` })
    ).not.toBeInTheDocument()
  )
}
it('creates directly from a text brief on the same workspace without requiring person, outfit or pose', async () => {
  const user = await openStudio()
  expect(screen.getByRole('heading', { name: 'Creative studio' })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Quick mode' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'AI creative assistant' })
  ).toBeDisabled()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A red bicycle beside a lake'
  )
  expect(createStudioTask).not.toHaveBeenCalled()
  await user.dblClick(screen.getByRole('button', { name: 'Generate image' }))
  expect(
    screen.queryByRole('dialog', { name: 'Review proposal' })
  ).not.toBeInTheDocument()
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createStudioTask).mock.calls[0][1].prompt).toBe(
    'A red bicycle beside a lake'
  )
  expect(vi.mocked(createStudioTask).mock.calls[0][2]).toEqual([])
})
it('keeps image editing in the unified references and removes style presets', async () => {
  const user = await openStudio()
  fireEvent.change(screen.getByLabelText(/Reference images/), {
    target: {
      files: [new File(['img'], 'bicycle.png', { type: 'image/png' })],
    },
  })
  expect(
    screen.queryByRole('button', { name: 'Clear Person' })
  ).not.toBeInTheDocument()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'Make the bicycle blue'
  )
  expect(
    screen.queryByRole('combobox', { name: 'Style' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'Purpose of reference 1' })
  ).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'AI creative assistant' })
  )
  await user.click(screen.getByRole('button', { name: 'Confirm & generate' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  const [, parameters, files, metadata] =
    vi.mocked(createStudioTask).mock.calls[0]
  expect(parameters.prompt).toContain('Make the bicycle blue')
  expect(parameters.prompt).not.toContain('apparel catalog')
  expect(files.map((f) => f.name)).toEqual(['bicycle.png'])
  expect(metadata.creativeContext?.referenceRoles).toEqual(['subject'])
  expect(metadata.creativeContext?.taskType).toBe('general')
})
it('selects an actual side-view pose image and sends that camera instruction with the image', async () => {
  const user = await openStudio()
  await choose(user, 'Outfit', 'Linen tailoring')
  await choose(user, 'Pose', 'Walking stride', 'Side view')
  expect(fetch).toHaveBeenCalledWith(
    '/images/studio/angles/walking-side.webp',
    expect.any(Object)
  )
  expect(screen.getByRole('combobox', { name: 'Camera angle' })).toHaveValue(
    'side'
  )
  await user.click(
    screen.getByRole('button', { name: 'Character & framing options' })
  )
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Model build' }),
    'athletic'
  )
  await user.click(
    screen.getByRole('button', { name: 'AI creative assistant' })
  )
  const review = screen.getByRole('dialog', { name: 'Review proposal' })
  expect(within(review).getByText('Athletic')).toBeVisible()
  await user.click(
    within(review).getByRole('button', { name: 'Confirm & generate' })
  )
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  const [, parameters, files] = vi.mocked(createStudioTask).mock.calls[0]
  expect(parameters.prompt).toContain('Camera: Side view')
  expect(parameters.prompt).toContain('athletic adult build')
  expect(files.map((f) => f.name)).toEqual([
    'Linen tailoring.webp',
    'Walking stride-Side view.webp',
  ])
})
it('outfit and pose libraries expose no upload paths, while person uploads remain available', async () => {
  const user = await openStudio()
  expect(
    screen.queryByRole('button', { name: 'Upload Outfit' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Upload Pose' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Add images to guide your creation' })
  ).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Reference library' }))
  const dialog = screen.getByRole('dialog', { name: 'Choose Outfit' })
  expect(
    within(dialog).queryByLabelText('Upload selected element')
  ).not.toBeInTheDocument()
  await user.click(within(dialog).getByRole('button', { name: 'Pose' }))
  expect(
    screen.queryByLabelText('Upload selected element')
  ).not.toBeInTheDocument()
})
it('changing selected pose angle replaces the file without duplicating references', async () => {
  const user = await openStudio()
  await choose(user, 'Person', 'Studio muse')
  await choose(user, 'Outfit', 'Midnight trench')
  await choose(user, 'Pose', 'Seated portrait', 'Front view')
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Camera angle' }),
    'back'
  )
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Camera angle' })).toHaveValue(
      'back'
    )
  )
  await user.click(
    screen.getByRole('button', { name: 'AI creative assistant' })
  )
  await user.click(screen.getByRole('button', { name: 'Confirm & generate' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  expect(
    vi.mocked(createStudioTask).mock.calls[0][2].map((f) => f.name)
  ).toEqual([
    'Studio muse.webp',
    'Midnight trench.webp',
    'Seated portrait-Back view.webp',
  ])
})
it('a failed pose replacement preserves the previous selected angle and blocks duplicate submission during loading', async () => {
  const user = await openStudio()
  await choose(user, 'Pose', 'Walking stride', 'Side view')
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Camera angle' }),
    'back'
  )
  await screen.findByRole('alert')
  expect(screen.getByRole('combobox', { name: 'Camera angle' })).toHaveValue(
    'side'
  )
  expect(createStudioTask).not.toHaveBeenCalled()
})
it('the server catalog load failure exposes retry and keeps text-only generation usable', async () => {
  vi.mocked(api.get).mockRejectedValue(new Error('offline'))
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A landscape'
  )
  expect(
    screen.getByRole('button', { name: 'AI creative assistant' })
  ).toBeEnabled()
  await user.click(screen.getByRole('tab', { name: 'Character composition' }))
  await user.click(
    within(
      screen.getByRole('complementary', { name: 'Creation settings' })
    ).getByRole('button', { name: 'Choose Pose' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not load the reference library.'
  )
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
})
it('rejects external image URLs in the server catalog', () => {
  expect(
    studioCatalogSchema.safeParse({
      version: 1,
      assets: [
        {
          id: 'external',
          role: 'pose',
          src: 'https://bad.test/private',
          instruction: '',
          views: [],
        },
      ],
    }).success
  ).toBe(false)
})
it('restores selected library view and retains the chosen image model on a new project', async () => {
  const asset = catalog.assets.find((a: { id: string }) => a.id === 'seated')
  vi.mocked(listCreativeProjects).mockResolvedValue([
    {
      version: 1,
      id: 'saved',
      ownerId: 1,
      title: 'My composition',
      updatedAt: 1,
      taskType: 'portrait',
      brief: 'Window light',
      parameters: {
        ...defaultImageParameters,
        group: 'basic',
        model: 'gpt-image-2-native',
      },
      references: [
        {
          id: 'p',
          file: new File(['p'], 'pose-seated-side.webp', {
            type: 'image/webp',
          }),
          role: 'pose',
          assetId: 'seated',
          assetView: 'side',
          assetRole: 'pose',
          assetInstruction: `${asset.instruction} Camera: Side view.`,
        },
      ],
      poster: {
        kicker: '',
        title: '',
        subtitle: '',
        position: 'top',
        align: 'left',
        size: 7,
        color: '#000000',
      },
      shoot: {
        body: 'curvy',
        stature: 'petite',
        framing: 'waist',
        finish: 'natural',
      },
    },
  ])
  const user = await openStudio()
  await user.click(screen.getByRole('button', { name: 'Saved projects' }))
  await user.click(
    await screen.findByRole('button', { name: 'My composition' })
  )
  expect(screen.getByRole('combobox', { name: 'Camera angle' })).toHaveValue(
    'side'
  )
  expect(
    screen.getByRole('textbox', { name: 'Additional instructions' })
  ).toHaveValue('Window light')
  await user.click(screen.getByRole('button', { name: 'New project' }))
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2-native'
  )
  expect(
    screen.queryByRole('button', { name: 'Clear Pose' })
  ).not.toBeInTheDocument()
})
it('legacy user-uploaded outfits cannot be submitted as built-in library assets', async () => {
  const user = await openStudio()
  act(() =>
    useImagePlaygroundStore.setState({
      references: [
        {
          id: 'legacy',
          file: new File(['a'], 'old.png', { type: 'image/png' }),
          preview: 'blob:old',
          role: 'outfit',
        },
      ],
    })
  )
  expect(
    screen.getByRole('button', { name: 'AI creative assistant' })
  ).toBeDisabled()
  expect(
    screen.getByText(
      'Reselect outfits and poses from the current library before generating.'
    )
  ).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: 'Remove reference old.png' })
  )
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A mountain'
  )
  expect(
    screen.getByRole('button', { name: 'AI creative assistant' })
  ).toBeEnabled()
})
it('model preferences are isolated per account and tolerate invalid saved data', () => {
  expect(
    saveStudioModelPreference(1, {
      model: 'gpt-image-2-native',
      group: 'basic',
    })
  ).toBe(true)
  expect(readStudioModelPreference(1)?.model).toBe('gpt-image-2-native')
  expect(readStudioModelPreference(2)).toBeNull()
  localStorage.setItem('image-studio-model-v1:1', 'bad json')
  expect(readStudioModelPreference(1)).toBeNull()
})
it('switching accounts clears the previous brief and references', async () => {
  const user = await openStudio()
  await choose(user, 'Pose', 'Walking stride')
  await user.type(
    screen.getByRole('textbox', { name: 'Additional instructions' }),
    'Private brief'
  )
  act(() =>
    useAuthStore.setState((s) => ({
      auth: {
        ...s.auth,
        user: { id: 2, username: 'other', role: 1 },
        session: s.auth.session
          ? { ...s.auth.session, sid: 'new-session' }
          : null,
      },
    }))
  )
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: 'What would you like to create?' })
    ).toHaveValue('')
  )
  expect(
    screen.queryByRole('button', { name: 'Clear Pose' })
  ).not.toBeInTheDocument()
})

it('browses the full imported catalog in pages and submits the selected original depth image through the site task API', async () => {
  const source = JSON.parse(
    readFileSync(
      'src/features/image-playground/__tests__/fixtures/depth-catalog.json',
      'utf8'
    )
  )
  vi.mocked(api.get).mockResolvedValue({
    data: { version: 1, assets: [], referenceCatalog: source },
  })
  vi.mocked(fetch).mockImplementation(
    async () =>
      ({
        ok: true,
        blob: async () => new Blob(['png'], { type: 'image/png' }),
      }) as Response
  )
  const user = await openStudio()
  await user.click(screen.getByRole('tab', { name: 'Character composition' }))
  await user.click(
    within(
      screen.getByRole('complementary', { name: 'Creation settings' })
    ).getByRole('button', { name: 'Choose Pose' })
  )
  const dialog = await screen.findByRole('dialog', { name: 'Choose Pose' })
  await waitFor(() =>
    expect(within(dialog).getByText('1 references')).toBeVisible()
  )
  expect(
    within(dialog).getAllByRole('button', { name: /^Select / })
  ).toHaveLength(1)
  await user.click(within(dialog).getByRole('button', { name: 'Depth map' }))
  await user.click(within(dialog).getByRole('button', { name: 'High angle' }))
  await user.click(
    within(dialog).getByRole('button', { name: 'Select Sitting study 001' })
  )
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  expect(fetch).toHaveBeenLastCalledWith(
    '/api/image-playground/assets/20261110/pose/originals/custom_pose_grid_20261105_seated_09_high_depth.png',
    expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  )
  expect(screen.getByRole('combobox', { name: 'Camera angle' })).toHaveValue(
    'custom_pose_grid_20261105_seated_09_high'
  )
  expect(screen.getByRole('switch', { name: 'Depth map' })).toBeChecked()
  await user.click(screen.getByRole('switch', { name: 'Depth map' }))
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Depth map' })).not.toBeChecked()
  )
  expect(useImagePlaygroundStore.getState().references[0].assetView).toBe(
    'custom_pose_grid_20261105_seated_09_high'
  )
  await user.click(screen.getByRole('switch', { name: 'Depth map' }))
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Depth map' })).toBeChecked()
  )

  expect(createStudioTask).not.toHaveBeenCalled()
  await user.click(
    screen.getByRole('button', { name: 'AI creative assistant' })
  )
  await user.click(screen.getByRole('button', { name: 'Confirm & generate' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  const [, parameters, files] = vi.mocked(createStudioTask).mock.calls[0]
  expect(parameters.model).toBe('gpt-image-2.5-flare-basic')
  expect(parameters.prompt).toContain('Camera: High angle')
  expect(parameters.prompt).toContain('AI inferred')
  expect(files[0].type).toBe('image/png')
  expect(files[0].name).toContain('High angle-Depth map.png')
})

it('keeps separate mode drafts and submits only the references visible in the active mode', async () => {
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'Make the bicycle blue'
  )
  fireEvent.change(screen.getByLabelText(/Reference images/), {
    target: { files: [new File(['bike'], 'bike.png', { type: 'image/png' })] },
  })
  await choose(user, 'Pose', 'Walking stride', 'Side view')
  await user.type(
    screen.getByRole('textbox', { name: 'Additional instructions' }),
    'Walking in a sunlit courtyard'
  )
  expect(
    useImagePlaygroundStore.getState().references.map((ref) => ref.role)
  ).toEqual(['pose'])
  await user.click(screen.getByRole('tab', { name: 'Free creation' }))
  expect(
    screen.getByRole('textbox', { name: 'What would you like to create?' })
  ).toHaveValue('Make the bicycle blue')
  expect(
    useImagePlaygroundStore.getState().references.map((ref) => ref.file.name)
  ).toEqual(['bike.png'])
  expect(
    screen.queryByRole('button', { name: 'Choose Pose' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  const [, parameters, files, metadata] =
    vi.mocked(createStudioTask).mock.calls[0]
  expect(files.map((file) => file.name)).toEqual(['bike.png'])
  expect(parameters.prompt).not.toContain('Camera:')
  expect(metadata.creativeContext?.taskType).toBe('general')
  await user.click(screen.getByRole('tab', { name: 'Character composition' }))
  expect(
    screen.getByRole('textbox', { name: 'Additional instructions' })
  ).toHaveValue('Walking in a sunlit courtyard')
  expect(screen.getByRole('combobox', { name: 'Camera angle' })).toHaveValue(
    'side'
  )
  await user.click(screen.getByRole('button', { name: 'Generate combination' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(2))
  const [, portraitParameters, portraitFiles, portraitMetadata] =
    vi.mocked(createStudioTask).mock.calls[1]
  expect(portraitFiles.map((file) => file.name)).toEqual([
    'Walking stride-Side view.webp',
  ])
  expect(portraitParameters.prompt).toContain('Walking in a sunlit courtyard')
  expect(portraitMetadata.creativeContext?.taskType).toBe('portrait')
  expect(portraitMetadata.creativeContext?.projectId).not.toBe(
    metadata.creativeContext?.projectId
  )
})

it('does not resubmit a pending request after switching modes or opening the assistant', async () => {
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A red bicycle'
  )
  await user.dblClick(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  await user.click(screen.getByRole('tab', { name: 'Character composition' }))
  await user.click(screen.getByRole('tab', { name: 'Free creation' }))
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'AI creative assistant' })
  ).toBeDisabled()
  expect(createStudioTask).toHaveBeenCalledTimes(1)
})

it('allows an explicit next generation after a completed result, and still deduplicates a double click', async () => {
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A blue bicycle'
  )
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  const [id, parameters, , metadata] = vi.mocked(createStudioTask).mock.calls[0]
  act(() =>
    useImagePlaygroundStore.setState({
      jobs: [],
      records: [
        {
          id,
          ownerId: 1,
          createdAt: Date.now(),
          parameters,
          creativeContext: metadata.creativeContext,
          referenceCount: 0,
          images: [{ id: 'result', src: 'data:image/png;base64,aQ==' }],
        },
      ],
    })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  )
  await user.dblClick(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
})

it('keeps AI planning optional and only generates after the reviewed plan is explicitly confirmed', async () => {
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A bottle in warm light'
  )
  await user.click(
    screen.getByRole('button', { name: 'AI creative assistant' })
  )
  const dialog = await screen.findByRole('dialog', { name: 'Review proposal' })
  expect(createStudioTask).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
  await user.click(
    within(dialog).getByRole('button', { name: 'Optimize with AI' })
  )
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  await within(dialog).findByText('Glass in sunlight')
  expect(createStudioTask).not.toHaveBeenCalled()
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm & generate' })
  )
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createStudioTask).mock.calls[0][1].prompt).toBe(
    proposal.prompt
  )
  const [id, parameters, , metadata] = vi.mocked(createStudioTask).mock.calls[0]
  act(() =>
    useImagePlaygroundStore.setState({
      jobs: [],
      records: [
        {
          id,
          ownerId: 1,
          createdAt: Date.now(),
          parameters,
          creativeContext: metadata.creativeContext,
          referenceCount: 0,
          images: [
            { id: 'optimized-result', src: 'data:image/png;base64,aQ==' },
          ],
        },
      ],
    })
  )
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(2))
  expect(vi.mocked(createStudioTask).mock.calls[1][1].prompt).toBe(
    proposal.prompt
  )
})

it('keeps the previous draft intact while choosing an original in the other mode', async () => {
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'Keep this draft'
  )
  await user.click(screen.getByRole('tab', { name: 'Character composition' }))
  await user.click(
    within(
      screen.getByRole('complementary', { name: 'Creation settings' })
    ).getByRole('button', { name: 'Choose Pose' })
  )
  let finish: ((response: Response) => void) | undefined
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  await user.click(
    screen.getByRole('button', { name: 'Select Walking stride' })
  )
  expect(
    screen.getByRole('button', { name: 'Select Walking stride' })
  ).toBeDisabled()
  await act(async () => {
    finish?.({
      ok: true,
      blob: async () => new Blob(['pose'], { type: 'image/webp' }),
    } as Response)
  })
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await user.click(screen.getByRole('tab', { name: 'Free creation' }))
  expect(
    screen.getByRole('textbox', { name: 'What would you like to create?' })
  ).toHaveValue('Keep this draft')
  expect(useImagePlaygroundStore.getState().references).toHaveLength(0)
})

it('keeps a failed submission draft and requires an explicit new action before retrying', async () => {
  vi.mocked(createStudioTask).mockRejectedValueOnce(new Error('offline'))
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A quiet coastline'
  )
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByRole('button', { name: 'Review and try again' })
  expect(createStudioTask).toHaveBeenCalledTimes(1)
  expect(
    screen.getByRole('textbox', { name: 'What would you like to create?' })
  ).toHaveValue('A quiet coastline')
  await user.click(screen.getByRole('button', { name: 'Review and try again' }))
  expect(createStudioTask).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(2))
})

it('edits the reviewed prompt without triggering generation and submits the exact edited text on confirmation', async () => {
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A coffee illustration'
  )
  await user.click(
    screen.getByRole('button', { name: 'AI creative assistant' })
  )
  const dialog = await screen.findByRole('dialog', { name: 'Review proposal' })
  const toggle = within(dialog).getByRole('button', {
    name: /Review & edit prompt/,
  })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(
    within(dialog).getByRole('button', { name: 'Copy prompt' })
  ).toBeVisible()
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const editor = within(dialog).getByRole('textbox', {
    name: 'Generation prompt',
  })
  await user.clear(editor)
  expect(
    within(dialog).getByRole('button', { name: 'Confirm & generate' })
  ).toBeDisabled()
  await user.type(editor, 'Coffee illustration with a cream background')
  expect(createStudioTask).not.toHaveBeenCalled()
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm & generate' })
  )
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createStudioTask).mock.calls[0][1].prompt).toBe(
    'Coffee illustration with a cream background'
  )
})

it('uses product model names throughout selection and review but sends the exact priced route identifier', async () => {
  const user = await openStudio()
  const model = screen.getByRole('combobox', { name: 'Model' })
  expect(model).toHaveTextContent('GPT Image 2.5 Flare')
  expect(model).not.toHaveTextContent('-basic')
  await user.click(model)
  const option = screen
    .getAllByRole('option')
    .find((item) => item.getAttribute('data-value') === 'gpt-image-2-native')
  if (!option) throw new Error('Native route missing')
  expect(option).toHaveTextContent('GPT Image 2')
  expect(option).not.toHaveTextContent('-native')
  await user.click(option)
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2-native'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A plain ceramic cup'
  )
  await user.click(
    screen.getByRole('button', { name: 'AI creative assistant' })
  )
  const review = screen.getByRole('dialog', { name: 'Review proposal' })
  expect(review).not.toHaveTextContent('gpt-image-2-native')
  expect(review).toHaveTextContent('GPT Image 2')
  await user.click(
    within(review).getByRole('button', { name: 'Confirm & generate' })
  )
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  expect(vi.mocked(createStudioTask).mock.calls[0][1].model).toBe(
    'gpt-image-2-native'
  )
})

it('preserves the aspect ratio when switching from a native route to an upscaled route', async () => {
  vi.mocked(getStudioGroups).mockResolvedValue([
    {
      id: 'basic',
      name: 'Images',
      description: '',
      ratio: 1,
      models: ['gpt-image-2.5-flare-basic', 'gpt-image-2-native'],
      available: true,
      size_mode: 'upscale',
      max_resolution: 4,
      model_profiles: {
        'gpt-image-2-native': { size_mode: 'native', max_resolution: 4 },
      },
    },
  ])
  const user = await openStudio()
  act(() =>
    useImagePlaygroundStore
      .getState()
      .setParameters({ model: 'gpt-image-2-native', size: '2304x3456' })
  )
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  const route = screen
    .getAllByRole('option')
    .find(
      (option) =>
        option.getAttribute('data-value') === 'gpt-image-2.5-flare-basic'
    )
  if (!route) throw new Error('Upscaled route missing')
  await user.click(route)
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2.5-flare-basic'
  )
  expect(useImagePlaygroundStore.getState().parameters.size).toBe('2736x4096')
  expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toHaveValue(
    '2:3'
  )
})

it('randomizes person, outfit and pose atomically without running a paid generation', async () => {
  const user = await openStudio()
  await user.click(screen.getByRole('tab', { name: 'Character composition' }))
  await user.click(screen.getByRole('button', { name: 'Random combination' }))
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().references).toHaveLength(3)
  )
  const first = useImagePlaygroundStore.getState().references
  expect(first.map((ref) => ref.role)).toEqual(['identity', 'outfit', 'pose'])
  expect(first.every((ref) => ref.file.size > 0 && ref.assetId)).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Random combination' }))
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().references[0].id).not.toBe(
      first[0].id
    )
  )
  const second = useImagePlaygroundStore.getState().references
  expect(
    second
      .filter((ref) => ref.role !== 'identity')
      .every((ref) => !first.some((old) => old.assetId === ref.assetId))
  ).toBe(true)
  expect(createStudioTask).not.toHaveBeenCalled()
})

it('keeps the complete previous combination when one randomized original cannot be loaded', async () => {
  const user = await openStudio()
  await user.click(screen.getByRole('tab', { name: 'Character composition' }))
  await user.click(screen.getByRole('button', { name: 'Random combination' }))
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().references).toHaveLength(3)
  )
  const previous = useImagePlaygroundStore.getState().references
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'))
  await user.click(screen.getByRole('button', { name: 'Random combination' }))
  await screen.findByRole('alert')
  expect(useImagePlaygroundStore.getState().references).toBe(previous)
  expect(createStudioTask).not.toHaveBeenCalled()
})

it('shows only the creative description while sending reference and character instructions privately', async () => {
  const user = await openStudio()
  await choose(user, 'Pose', 'Walking stride', 'Side view')
  await user.type(
    screen.getByRole('textbox', { name: 'Additional instructions' }),
    'Walk beside a lake'
  )
  await user.click(
    screen.getByRole('button', { name: 'AI creative assistant' })
  )
  const dialog = screen.getByRole('dialog', { name: 'Review proposal' })
  await user.click(
    within(dialog).getByRole('button', { name: /Review & edit prompt/ })
  )
  const editor = within(dialog).getByRole('textbox', {
    name: 'Generation prompt',
  })
  expect(editor).toHaveValue('Walk beside a lake')
  expect(editor).not.toHaveValue(expect.stringContaining('Camera:'))
  await user.clear(editor)
  await user.type(editor, 'Walking in warm evening light')
  await user.click(
    within(dialog).getByRole('button', { name: 'Confirm & generate' })
  )
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  const [, request, , metadata] = vi.mocked(createStudioTask).mock.calls[0]
  expect(request.prompt).toContain('Walking in warm evening light')
  expect(request.prompt).toContain('Camera: Side view')
  expect(metadata.parameters.prompt).toBe('Walking in warm evening light')
  expect(metadata.parameters).not.toHaveProperty('requestPrompt')
})

function historyCreation() {
  return {
    id: 'history-art',
    ownerId: 1,
    createdAt: 1,
    parameters: {
      ...defaultImageParameters,
      group: 'basic',
      model: 'gpt-image-2-native',
      size: '1536x1024',
      prompt: 'A blue bicycle by a lake',
    },
    styleId: null,
    referenceCount: 0,
    images: [
      {
        id: 'history-image',
        src: '/images/studio/scenes/ivory.webp',
        width: 900,
        height: 1200,
      },
    ],
  }
}
it('returns from My creations to the creative form when reusing settings', async () => {
  const user = await openStudio()
  act(() => useImagePlaygroundStore.setState({ records: [historyCreation()] }))
  await user.click(screen.getByRole('button', { name: 'My creations' }))
  const history = await screen.findByRole('dialog', { name: 'My creations' })
  await user.click(
    await within(history).findByRole('button', { name: 'Reuse settings' })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'My creations' })
    ).not.toBeInTheDocument()
  )
  expect(
    screen.getByRole('textbox', { name: 'What would you like to create?' })
  ).toHaveValue('A blue bicycle by a lake')
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2-native'
  )
  expect(useImagePlaygroundStore.getState().references).toHaveLength(0)
  expect(createStudioTask).not.toHaveBeenCalled()
})
it('returns from My creations and attaches the selected output when continuing editing', async () => {
  const user = await openStudio()
  act(() => useImagePlaygroundStore.setState({ records: [historyCreation()] }))
  await user.click(screen.getByRole('button', { name: 'My creations' }))
  const history = await screen.findByRole('dialog', { name: 'My creations' })
  await user.click(
    within(history).getByRole('button', { name: 'Continue editing' })
  )
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'My creations' })
    ).not.toBeInTheDocument()
  )
  expect(
    screen.getByRole('textbox', { name: 'What would you like to create?' })
  ).toHaveValue('A blue bicycle by a lake')
  expect(useImagePlaygroundStore.getState().references).toHaveLength(1)
  expect(fetch).toHaveBeenCalledWith(
    '/images/studio/scenes/ivory.webp',
    expect.any(Object)
  )
  expect(createStudioTask).not.toHaveBeenCalled()
})

it('returns from the enlarged creation preview when continuing editing', async () => {
  const user = await openStudio()
  act(() => useImagePlaygroundStore.setState({ records: [historyCreation()] }))
  await user.click(screen.getByRole('button', { name: 'My creations' }))
  const history = await screen.findByRole('dialog', { name: 'My creations' })
  await user.click(
    await within(history).findByRole('button', { name: 'Image Preview' })
  )
  const buttons = await screen.findAllByRole('button', {
    name: 'Continue editing',
  })
  const button = buttons.at(-1)
  if (!button) throw new Error('Preview continue action missing')
  await user.click(button)
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'My creations' })
    ).not.toBeInTheDocument()
  )
  expect(useImagePlaygroundStore.getState().references).toHaveLength(1)
})

it('disables history restore actions while reference originals are still being loaded', async () => {
  const user = await openStudio()
  act(() => useImagePlaygroundStore.setState({ records: [historyCreation()] }))
  let finish: ((response: Response) => void) | undefined
  vi.mocked(fetch).mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve
      })
  )
  await user.click(screen.getByRole('tab', { name: 'Character composition' }))
  await user.click(screen.getByRole('button', { name: 'Random combination' }))
  await user.click(screen.getByRole('button', { name: 'My creations' }))
  const history = await screen.findByRole('dialog', { name: 'My creations' })
  expect(
    await within(history).findByRole('button', { name: 'Reuse settings' })
  ).toBeDisabled()
  expect(
    within(history).getByRole('button', { name: 'Continue editing' })
  ).toBeDisabled()
  if (!finish) throw new Error('Pending image request missing')
  finish({
    ok: true,
    blob: async () => new Blob(['image'], { type: 'image/webp' }),
  } as Response)
  await waitFor(() =>
    expect(
      within(history).getByRole('button', { name: 'Reuse settings' })
    ).toBeEnabled()
  )
  expect(createStudioTask).not.toHaveBeenCalled()
})

it('removes a withdrawn pose and its proposal when restoring an old saved project', async () => {
  vi.mocked(listCreativeProjects).mockResolvedValue([
    {
      version: 1,
      id: 'retired-project',
      ownerId: 1,
      title: 'Retired pose title',
      updatedAt: 1,
      taskType: 'portrait',
      brief: 'Window light',
      parameters: {
        ...defaultImageParameters,
        group: 'basic',
        model: 'gpt-image-2.5-flare-basic',
      },
      references: [
        {
          id: 'retired-pose',
          file: new File(['old'], 'old-pose.png', { type: 'image/png' }),
          role: 'pose',
          assetId: 'pair60_P007',
          assetRole: 'pose',
          assetView: 'pair60_P007_front',
          assetInstruction: 'Withdrawn pose instruction',
        },
      ],
      poster: {
        kicker: '',
        title: '',
        subtitle: '',
        color: '#000000',
        position: 'top',
        align: 'left',
        size: 7,
      },
      plan: {
        inputKey: 'old',
        source: 'manual',
        value: {
          ...proposal,
          title: 'Retired pose title',
          prompt: 'Withdrawn pose instruction',
        },
      },
    },
  ])
  const user = await openStudio()
  await user.click(screen.getByRole('button', { name: 'Saved projects' }))
  expect(
    screen.queryByRole('button', { name: 'Retired pose title' })
  ).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Window light' }))
  expect(useImagePlaygroundStore.getState().references).toHaveLength(0)
  expect(
    screen.getByRole('textbox', { name: 'Additional instructions' })
  ).toHaveValue('Window light')
  expect(
    screen.queryByText('Withdrawn pose instruction')
  ).not.toBeInTheDocument()
  expect(createStudioTask).not.toHaveBeenCalled()
})

it('clears a withdrawn pose from a live draft before allowing any new generation', async () => {
  await openStudio()
  act(() =>
    useImagePlaygroundStore.setState({
      references: [
        {
          id: 'old-pose',
          file: new File(['old'], 'old.png', { type: 'image/png' }),
          preview: 'blob:old',
          role: 'pose',
          assetId: 'upper80v2_P051',
        },
      ],
    })
  )
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().references).toHaveLength(0)
  )
  expect(createStudioTask).not.toHaveBeenCalled()
})

it('keeps one canvas surface from the empty preview through generation and the delivered image', async () => {
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A quiet lake at sunrise'
  )
  const region = screen.getByRole('region', { name: 'Your creation' })
  const canvas = region.querySelector('.compose-canvas-card')
  expect(canvas).toHaveAttribute('data-state', 'idle')
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(canvas).toHaveAttribute('data-state', 'generating')
  )
  await waitFor(() => expect(within(region).getByText('Queued')).toBeVisible())
  expect(region.querySelectorAll('.compose-canvas-card')).toHaveLength(1)
  expect(region.querySelectorAll('.compose-empty')).toHaveLength(0)
  expect(
    region.querySelectorAll('.studio-job-card.is-canvas-progress')
  ).toHaveLength(1)
  expect(
    region.querySelector('.studio-job-card')?.closest('.compose-canvas-card')
  ).toBe(canvas)
  expect(
    within(region).queryByText('Give your idea a picture.')
  ).not.toBeInTheDocument()
  const job = useImagePlaygroundStore.getState().jobs[0]
  const context = vi.mocked(createStudioTask).mock.calls[0][3].creativeContext
  act(() =>
    useImagePlaygroundStore.setState({
      jobs: [],
      records: [
        {
          id: job.id,
          ownerId: 1,
          createdAt: job.startedAt,
          parameters: job.parameters,
          referenceCount: 0,
          styleId: null,
          creativeContext: context,
          images: [
            {
              id: 'delivered-image',
              src: 'data:image/png;base64,dGVzdA==',
              width: 1024,
              height: 1024,
            },
          ],
        },
      ],
    })
  )
  await waitFor(() =>
    expect(
      within(region).getByRole('img', { name: 'Generated image' })
    ).toBeInTheDocument()
  )
  expect(canvas).toHaveAttribute('data-state', 'ready')
  expect(region.querySelector('.compose-canvas-card')).toBe(canvas)
  expect(region.querySelector('.studio-job-card')).not.toBeInTheDocument()
})

it('keeps reference thumbnails in the same canvas while generating and after failure', async () => {
  const user = await openStudio()
  await choose(user, 'Person', 'Studio muse')
  await choose(user, 'Outfit', 'Linen tailoring')
  await choose(user, 'Pose', 'Walking stride', 'Side view')
  const region = screen.getByRole('region', { name: 'Your creation' })
  const canvas = region.querySelector('.compose-canvas-card')
  const combination = within(region).getByLabelText('Combination preview')
  const selectedFiles = useImagePlaygroundStore
    .getState()
    .references.map((reference) => reference.file)
  await user.click(screen.getByRole('button', { name: 'Generate combination' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  await waitFor(() => expect(within(region).getByText('Queued')).toBeVisible())
  expect(within(region).getByLabelText('Combination preview')).toBe(combination)
  expect(
    useImagePlaygroundStore
      .getState()
      .jobs[0].referenceFiles?.map((reference) => reference.file)
  ).toEqual(selectedFiles)
  expect(within(combination).getAllByRole('img')).toHaveLength(3)
  act(() =>
    useImagePlaygroundStore.setState((state) => ({
      jobs: state.jobs.map((job) => ({
        ...job,
        error: 'Provider temporarily unavailable',
      })),
    }))
  )
  await waitFor(() =>
    expect(within(region).getByRole('alert')).toHaveTextContent(
      'Provider temporarily unavailable'
    )
  )
  expect(region.querySelector('.compose-canvas-card')).toBe(canvas)
  expect(canvas).toHaveAttribute('data-state', 'failed')
  expect(
    within(region).queryByText('See your references come together.')
  ).not.toBeInTheDocument()
  expect(createStudioTask).toHaveBeenCalledTimes(1)
})

it('shows only the current project task in the canvas and keeps other tasks available in history', async () => {
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A watercolor landscape'
  )
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  const region = screen.getByRole('region', { name: 'Your creation' })
  const current = useImagePlaygroundStore.getState().jobs[0]
  if (!current.creativeContext) {
    throw new Error('Project identity missing from task')
  }
  const context = current.creativeContext
  act(() =>
    useImagePlaygroundStore.setState({
      jobs: [
        {
          ...current,
          id: 'unrelated-task',
          creativeContext: {
            ...context,
            projectId: 'another-project',
          },
          error: 'Unrelated project failure',
        },
        current,
      ],
    })
  )
  await waitFor(() => expect(within(region).getByText('Queued')).toBeVisible())
  expect(
    within(region).queryByText('Unrelated project failure')
  ).not.toBeInTheDocument()
  expect(region.querySelectorAll('.studio-job-card')).toHaveLength(1)
  act(() =>
    useImagePlaygroundStore.setState((state) => ({
      jobs: [
        ...state.jobs,
        {
          ...current,
          id: 'second-project-task',
          startedAt: current.startedAt + 1,
        },
      ],
    }))
  )
  expect(
    within(region).getByRole('group', { name: 'Task ID' })
  ).toBeInTheDocument()
  expect(region.querySelectorAll('.studio-job-card')).toHaveLength(1)
})

it('keeps the canvas active while a finished server task is preparing its local preview', async () => {
  const user = await openStudio()
  await user.type(
    screen.getByRole('textbox', { name: 'What would you like to create?' }),
    'A sunrise over hills'
  )
  await user.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(1))
  const [id, , , metadata] = vi.mocked(createStudioTask).mock.calls[0]
  let finishPreview: ((blob: Blob) => void) | undefined
  vi.mocked(api.get).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishPreview = (blob: Blob) => resolve({ data: blob })
      })
  )
  vi.mocked(listStudioTasks).mockResolvedValue([
    {
      id,
      metadata,
      status: 'ready',
      created_at: Date.now(),
      expires_at: 9999999999,
      downloaded_bytes: 1,
      total_bytes: 1,
      images: [
        {
          index: 0,
          width: 1024,
          height: 1024,
          bytes: 10,
          content_type: 'image/png',
        },
      ],
    },
  ])
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['image-studio-tasks'] })
  })
  const region = screen.getByRole('region', { name: 'Your creation' })
  await waitFor(() =>
    expect(within(region).getByText('Saving images locally...')).toBeVisible()
  )
  expect(region.querySelector('.compose-canvas-card')).toHaveAttribute(
    'data-state',
    'generating'
  )
  expect(
    within(region).queryByText('Give your idea a picture.')
  ).not.toBeInTheDocument()
  if (!finishPreview) throw new Error('Thumbnail request missing')
  finishPreview(new Blob(['image'], { type: 'image/png' }))
  await waitFor(() =>
    expect(region.querySelector('.compose-canvas-card')).toHaveAttribute(
      'data-state',
      'ready'
    )
  )
  await waitFor(() =>
    expect(
      within(region).getByRole('img', { name: 'Generated image' })
    ).toBeInTheDocument()
  )
  expect(createStudioTask).toHaveBeenCalledTimes(1)
})
