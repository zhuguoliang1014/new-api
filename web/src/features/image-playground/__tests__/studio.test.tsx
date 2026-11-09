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
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getPricing } from '@/features/pricing/api'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import {
  createStudioTask,
  listStudioTasks,
  type StudioTask,
  getPlaygroundAgentConfig,
  getStudioGroups,
  refinePrompt,
  savePlaygroundAgentConfig,
} from '../api'
import { QuickImageStudio as ImagePlayground } from '../index'
import { readImageHistory, saveImageRecord } from '../lib/history'
import * as imageFiles from '../lib/images'
import { applyStyleTemplate, stylePresets } from '../lib/style-presets'
import { useImagePlaygroundStore } from '../store'

vi.mock('@/lib/api', async (original) => ({
  ...(await original<typeof import('@/lib/api')>()),
  getStatus: vi.fn().mockResolvedValue({
    price: 1,
    usd_exchange_rate: 6.9,
    quota_per_unit: 500000,
  }),
  getUserModels: vi.fn().mockResolvedValue({
    success: true,
    data: ['gpt-6.1-sol', 'gpt-image-2'],
  }),
}))
vi.mock('@/features/pricing/api', () => ({ getPricing: vi.fn() }))
vi.mock('@/features/keys/api', async (original) => ({
  ...(await original<typeof import('@/features/keys/api')>()),
  getApiKeys: vi.fn().mockResolvedValue({
    success: true,
    data: {
      items: [
        {
          id: 11,
          name: 'Prompt key',
          key: 'sk-...11',
          status: 1,
          remain_quota: 100,
          used_quota: 0,
          unlimited_quota: false,
          expired_time: -1,
          created_time: 0,
          accessed_time: 0,
          group: 'default',
          auto_groups: null,
          cross_group_retry: false,
          model_limits_enabled: false,
          model_limits: '',
          allow_ips: '',
        },
        {
          id: 12,
          name: 'Image key',
          key: 'sk-...12',
          status: 1,
          remain_quota: 100,
          used_quota: 0,
          unlimited_quota: false,
          expired_time: -1,
          created_time: 0,
          accessed_time: 0,
          group: 'default',
          auto_groups: null,
          cross_group_retry: false,
          model_limits_enabled: false,
          model_limits: '',
          allow_ips: '',
        },
      ],
      total: 2,
      page: 1,
      page_size: 100,
    },
  }),
}))

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  createStudioTask: vi.fn(),
  listStudioTasks: vi.fn(),
  deleteStudioTask: vi.fn().mockResolvedValue(undefined),
  retryStudioDownload: vi.fn().mockResolvedValue(undefined),
  getStudioGroups: vi.fn(),
  refinePrompt: vi.fn(),
  getPlaygroundAgentConfig: vi.fn().mockResolvedValue({
    prompt: { token_id: 11, model: 'gpt-6.1-sol' },
    image: { token_id: 12, model: 'gpt-image-2' },
  }),
  savePlaygroundAgentConfig: vi
    .fn()
    .mockImplementation(async (config) => config),
}))
vi.mock('../lib/history', () => ({
  readImageHistory: vi.fn(),
  saveImageRecord: vi.fn(),
  deleteImageRecord: vi.fn(),
}))
const image = { id: 'image-one', src: 'data:image/png;base64,aW1hZ2U=' }
let client: QueryClient
let serverTasks: StudioTask[]
function taskFixture(
  id: string,
  metadata: StudioTask['metadata'],
  status: StudioTask['status'] = 'ready'
): StudioTask {
  return {
    id,
    metadata,
    status,
    created_at: Date.now(),
    expires_at: Math.floor(Date.now() / 1000) + 36000,
    images: [
      { index: 0, width: 32, height: 16, bytes: 5, content_type: 'image/png' },
    ],
    downloaded_bytes: 0,
    total_bytes: 0,
  }
}
async function selectModel(value: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  const option = screen
    .getAllByRole('option')
    .find((item) => item.getAttribute('data-value') === value)
  expect(option).toBeDefined()
  if (!option) throw new Error(`Model option ${value} was not shown`)
  await user.click(option)
}

function acceptPendingTasks() {
  vi.mocked(createStudioTask).mockImplementation(
    async (id, _parameters, _references, metadata) => {
      const task = taskFixture(id, metadata, 'generating')
      serverTasks.push(task)
      return task
    }
  )
}
async function updateTask(index: number, changes: Partial<StudioTask>) {
  serverTasks[index] = { ...serverTasks[index], ...changes }
  await client.invalidateQueries({ queryKey: ['image-studio-tasks'] })
}

beforeEach(() => {
  useImagePlaygroundStore.getState().setScope(null)
  useAuthStore.setState((state) => ({
    auth: {
      ...state.auth,
      user: { id: 1, username: 'artist', role: 1 },
      session: {
        sid: 'session-a',
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
      id: 'native',
      name: 'Native',
      description: 'Native generation',
      ratio: 2.25,
      models: ['gpt-image-2', 'gpt-image-2.5-flare'],
      max_resolution: 4,
      size_mode: 'native',
      available: true,
    },
    {
      id: 'basic',
      name: 'Basic',
      description: 'Daily generation',
      ratio: 0.3,
      models: ['gpt-image-2', 'gpt-image-2.5'],
      max_resolution: 4,
      size_mode: 'upscale',
      available: true,
    },
    {
      id: 'high',
      name: 'High resolution',
      description: 'High resolution',
      ratio: 1.2,
      models: ['gpt-image-2', 'gpt-image-2.5'],
      max_resolution: 8,
      size_mode: 'upscale',
      available: true,
    },
  ])
  vi.mocked(getPricing).mockResolvedValue({
    success: true,
    data: ['gpt-image-2', 'gpt-image-2.5', 'gpt-image-2.5-flare'].map(
      (model_name) => ({
        id: 0,
        model_name,
        quota_type: 0,
        model_ratio: 37.5,
        completion_ratio: 2,
        enable_groups: ['basic', 'high', 'native'],
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("image", fixed(0.1)) * image_count',
      })
    ),
    vendors: [],
    group_ratio: {},
    usable_group: {},
    supported_endpoint: {},
    auto_groups: [],
  })
  vi.mocked(readImageHistory).mockResolvedValue([])
  vi.mocked(saveImageRecord).mockResolvedValue()
  serverTasks = []
  vi.mocked(listStudioTasks).mockImplementation(async () => [...serverTasks])
  vi.mocked(createStudioTask).mockImplementation(
    async (id, _parameters, _references, metadata) => {
      const task = taskFixture(id, metadata)
      serverTasks.push(task)
      return task
    }
  )
  vi.spyOn(api, 'get').mockResolvedValue({
    data: new Blob(['image'], { type: 'image/png' }),
  })
  vi.mocked(refinePrompt).mockResolvedValue('A polished studio prompt')
  vi.mocked(savePlaygroundAgentConfig).mockImplementation(
    async (config) => config
  )
  vi.stubGlobal(
    'URL',
    Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => 'blob:reference'),
      revokeObjectURL: vi.fn(),
    })
  )
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})

function showStudio() {
  return render(
    <QueryClientProvider client={client}>
      <ImagePlayground />
    </QueryClientProvider>
  )
}
async function ready() {
  await screen.findByRole('textbox', { name: 'Image prompt' })
  await waitFor(() =>
    expect(
      screen.getByRole('combobox', { name: 'Generation group' })
    ).toHaveValue('native')
  )
}

it('defaults to the highest group resolution while keeping explicit choices and the aspect ratio', async () => {
  showStudio()
  await ready()
  expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.getByText('For detailed creative work')).toBeInTheDocument()
  expect(screen.queryByText(/Maximum edge:/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '16:9' }))
  fireEvent.click(screen.getByRole('button', { name: '1K' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A coastal house' },
  })
  expect(screen.getByRole('button', { name: '1K' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'high' },
  })
  expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(screen.getByRole('button', { name: '16:9' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(
    screen.getByText('For high-resolution posters and covers')
  ).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'basic' },
  })
  expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(
    screen.getByText('For everyday images and batch creation')
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() =>
    expect(createStudioTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ group: 'basic', size: '4096x2304' }),
      [],
      expect.any(Object),
      expect.any(AbortSignal)
    )
  )
})

it('starts without a key setup dialog and exposes the selected group models', async () => {
  vi.mocked(getPlaygroundAgentConfig).mockResolvedValueOnce({
    prompt: null,
    image: null,
  })
  showStudio()
  await ready()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
  await selectModel('gpt-image-2.5-flare')
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'high' },
  })
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent(
    'GPT Image 2'
  )
  expect(
    screen.queryByRole('option', { name: 'gpt-image-2.5-flare' })
  ).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '10K' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '4K' }))
  expect(useImagePlaygroundStore.getState().parameters.size).toBe('4096x4096')
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'basic' },
  })
  expect(screen.queryByRole('button', { name: '8K' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

it('keeps submission disabled and offers retry when groups fail to load', async () => {
  vi.mocked(getStudioGroups).mockRejectedValueOnce(new Error('Offline'))
  showStudio()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not load generation groups.'
  )
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await ready()
})

it('explains when the account has no available image groups', async () => {
  vi.mocked(getStudioGroups).mockResolvedValueOnce([])
  showStudio()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No image groups are available for this account.'
  )
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
})

it('allows optional prompt-only setup without an image key selection', async () => {
  showStudio()
  await ready()
  fireEvent.click(
    screen.getByRole('button', { name: 'Prompt refinement settings' })
  )
  const dialog = await screen.findByRole('dialog', {
    name: 'Prompt refinement',
  })
  expect(
    within(dialog).queryByLabelText('Image generation API Key')
  ).not.toBeInTheDocument()
  fireEvent.change(await screen.findByLabelText('Prompt refinement API Key'), {
    target: { value: '12' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }))
  await waitFor(() =>
    expect(savePlaygroundAgentConfig).toHaveBeenCalledWith(
      { prompt: { token_id: 12, model: 'gpt-6.1-sol' }, image: null },
      expect.anything()
    )
  )
})

it('offers a keyboard-accessible image tile for adding references', async () => {
  const user = userEvent.setup()
  showStudio()
  await ready()
  const tile = screen.getByRole('button', {
    name: 'Add images to guide your creation',
  })
  expect(tile).toHaveTextContent('Drop or paste a reference image')
  const input = screen.getByLabelText(/Reference images/)
  const click = vi.spyOn(input, 'click')
  tile.focus()
  await user.keyboard('{Enter}')
  expect(click).toHaveBeenCalledOnce()
})

it('hides the add-reference tile at four images and restores it after removal', async () => {
  showStudio()
  await ready()
  fireEvent.change(screen.getByLabelText(/Reference images/), {
    target: {
      files: ['first.png', 'second.png', 'third.png', 'fourth.png'].map(
        (name) => new File(['image'], name, { type: 'image/png' })
      ),
    },
  })
  expect(
    screen.queryByRole('button', { name: 'Add images to guide your creation' })
  ).not.toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove reference first.png' })
  )
  expect(
    screen.getByRole('button', { name: 'Add images to guide your creation' })
  ).toBeEnabled()
})

it('keeps the draft intact while applying a selected style to generation', async () => {
  showStudio()
  await ready()
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: '画一只猫' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), {
    target: { value: 'product' },
  })
  expect(
    (
      screen.getByRole('textbox', {
        name: 'Image prompt',
      }) as HTMLTextAreaElement
    ).value
  ).toBe('画一只猫')
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByRole('button', { name: 'Continue editing' })
  expect(createStudioTask).toHaveBeenCalledTimes(1)
  expect(createStudioTask).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      prompt: expect.stringContaining('画一只猫 placed on'),
    }),
    [],
    expect.any(Object),
    expect.any(AbortSignal)
  )
  expect(screen.getByRole('combobox', { name: 'Style' })).toHaveValue('product')
  await waitFor(() =>
    expect(saveImageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 1,
        referenceCount: 0,
        images: [expect.objectContaining({ src: image.src })],
        styleId: 'product',
        parameters: expect.objectContaining({ prompt: '画一只猫' }),
      })
    )
  )
  fireEvent.click(screen.getByRole('button', { name: 'Image Preview' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
})

it('starts a new canvas by clearing the draft while keeping the Agent defaults', async () => {
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A quiet studio portrait' },
  })
  fireEvent.change(screen.getByLabelText(/Reference images/), {
    target: {
      files: [new File(['one'], 'reference.png', { type: 'image/png' })],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'New draft' }))
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue('')
  expect(useImagePlaygroundStore.getState().references).toHaveLength(0)
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2'
  )
})

it('filters saved creations by prompt and model', async () => {
  const parameters = useImagePlaygroundStore.getState().parameters
  vi.mocked(readImageHistory).mockResolvedValue([
    {
      id: 'sunrise',
      ownerId: 1,
      createdAt: 2,
      parameters: { ...parameters, prompt: 'A quiet sunrise over the sea' },
      images: [image],
      referenceCount: 0,
    },
    {
      id: 'ocean',
      ownerId: 1,
      createdAt: 1,
      parameters: {
        ...parameters,
        model: 'ocean-model',
        prompt: 'A blue ocean in the afternoon',
      },
      images: [{ ...image, id: 'image-two' }],
      referenceCount: 0,
    },
  ])
  showStudio()
  await ready()
  expect(screen.getAllByRole('button', { name: 'Image Preview' })).toHaveLength(
    2
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Search creations' }), {
    target: { value: 'ocean-model' },
  })
  expect(screen.getAllByRole('button', { name: 'Image Preview' })).toHaveLength(
    1
  )
  expect(
    screen.queryByText('A quiet sunrise over the sea')
  ).not.toBeInTheDocument()
})

it.each([
  {
    signal: 'an active composition session',
    compositionStarted: true,
    isComposing: false,
    keyCode: 13,
  },
  {
    signal: 'the native composition flag',
    compositionStarted: false,
    isComposing: true,
    keyCode: 13,
  },
  {
    signal: 'the legacy IME key code',
    compositionStarted: false,
    isComposing: false,
    keyCode: 229,
  },
])(
  'ignores IME confirmation with $signal and allows the shortcut after composition',
  async ({ compositionStarted, isComposing, keyCode }) => {
    showStudio()
    await ready()
    const prompt = screen.getByRole('textbox', { name: 'Image prompt' })
    fireEvent.change(prompt, { target: { value: '画一只猫' } })
    if (compositionStarted) fireEvent.compositionStart(prompt)
    await act(async () => {
      fireEvent.keyDown(prompt, {
        key: 'Enter',
        ctrlKey: true,
        isComposing,
        keyCode,
      })
    })
    expect(createStudioTask).not.toHaveBeenCalled()
    expect(prompt).toHaveValue('画一只猫')

    fireEvent.compositionEnd(prompt, { data: '猫' })
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true, keyCode: 13 })
    await waitFor(() =>
      expect(createStudioTask).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ prompt: '画一只猫' }),
        [],
        expect.any(Object),
        expect.any(AbortSignal)
      )
    )
    expect(createStudioTask).toHaveBeenCalledTimes(1)
  }
)

it('preserves the caret while composing Chinese in the middle of a prompt', async () => {
  showStudio()
  await ready()
  const prompt = screen.getByRole('textbox', {
    name: 'Image prompt',
  }) as HTMLTextAreaElement
  fireEvent.change(prompt, { target: { value: '画  风景' } })
  prompt.focus()
  prompt.setSelectionRange(2, 2)
  fireEvent.compositionStart(prompt)
  fireEvent.input(prompt, {
    target: { value: '画 ni 风景', selectionStart: 4, selectionEnd: 4 },
    inputType: 'insertCompositionText',
    data: 'ni',
    isComposing: true,
  })
  expect(prompt).toHaveValue('画 ni 风景')
  expect(prompt).toHaveFocus()
  expect(prompt.selectionStart).toBe(4)
  expect(prompt.selectionEnd).toBe(4)

  fireEvent.input(prompt, {
    target: { value: '画 你的 风景', selectionStart: 4, selectionEnd: 4 },
    inputType: 'insertCompositionText',
    data: '你的',
    isComposing: true,
  })
  fireEvent.compositionEnd(prompt, { data: '你的' })
  expect(prompt).toHaveValue('画 你的 风景')
  expect(prompt.selectionStart).toBe(4)
  fireEvent.keyDown(prompt, { key: 'Enter', metaKey: true })
  await waitFor(() =>
    expect(createStudioTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ prompt: '画 你的 风景' }),
      [],
      expect.any(Object),
      expect.any(AbortSignal)
    )
  )
})

it('keeps committed Chinese text and multiline edits when output settings change', async () => {
  showStudio()
  await ready()
  const prompt = screen.getByRole('textbox', { name: 'Image prompt' })
  prompt.focus()
  fireEvent.compositionStart(prompt)
  fireEvent.change(prompt, { target: { value: 'hua' } })
  expect(prompt).toHaveValue('hua')
  expect(prompt).toHaveFocus()
  fireEvent.change(prompt, { target: { value: '画一只猫' } })
  fireEvent.compositionEnd(prompt, { data: '画一只猫' })
  fireEvent.click(screen.getByRole('button', { name: '1K' }))
  fireEvent.click(screen.getByRole('button', { name: '3:2' }))
  expect(prompt).toHaveValue('画一只猫')
  fireEvent.change(prompt, { target: { value: '画一只猫\n坐在窗边' } })
  fireEvent.keyDown(prompt, { key: 'Enter' })
  expect(createStudioTask).not.toHaveBeenCalled()
  fireEvent.change(prompt, { target: { value: '画一只猫\n坐在窗' } })
  fireEvent.change(prompt, { target: { value: '' } })
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  fireEvent.change(prompt, { target: { value: '画一只猫\n坐在窗' } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() =>
    expect(createStudioTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        prompt: '画一只猫\n坐在窗',
        size: '1536x1024',
      }),
      [],
      expect.any(Object),
      expect.any(AbortSignal)
    )
  )
})

it('recovers a server task after refresh without resubmitting generation', async () => {
  acceptPendingTasks()
  const view = showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A mountain lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByText('Creating...')
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  expect(
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
  ).toBe(true)
  view.unmount()
  useImagePlaygroundStore.setState({
    jobs: [],
    records: [],
    historyLoaded: false,
  })
  serverTasks[0] = { ...serverTasks[0], status: 'ready' }
  showStudio()
  expect(
    await screen.findByRole('button', { name: 'Continue editing' })
  ).toBeEnabled()
  expect(createStudioTask).toHaveBeenCalledTimes(1)
})
it('shows API failure once and keeps the draft for an explicit retry', async () => {
  vi.mocked(createStudioTask).mockRejectedValue(new Error('Insufficient quota'))
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A mountain lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Insufficient quota'
  )
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue(
    'A mountain lake'
  )
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  expect(createStudioTask).toHaveBeenCalledTimes(1)
  expect(saveImageRecord).not.toHaveBeenCalled()
})

it('uploads and removes references and sends only the remaining files to edits', async () => {
  showStudio()
  await ready()
  const input = screen.getByLabelText(/Reference images/) as HTMLInputElement
  const files = [
    new File(['one'], 'one.png', { type: 'image/png' }),
    new File(['two'], 'two.png', { type: 'image/png' }),
  ]
  fireEvent.change(input, { target: { files } })
  expect(screen.getByAltText('one.png')).toBeInTheDocument()
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove reference one.png' })
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'Keep the scene, make it snowy' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() =>
    expect(createStudioTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ prompt: 'Keep the scene, make it snowy' }),
      [files[1]],
      expect.any(Object),
      expect.any(AbortSignal)
    )
  )
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference')
})

it('clears private browser state on logout while the server task continues', async () => {
  acceptPendingTasks()
  showStudio()
  await ready()
  fireEvent.change(screen.getByLabelText(/Reference images/), {
    target: { files: [new File(['one'], 'one.png', { type: 'image/png' })] },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A private idea' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByText('Creating...')
  act(() => useAuthStore.getState().auth.reset())
  await act(async () => updateTask(0, { status: 'ready' }))
  expect(useImagePlaygroundStore.getState()).toMatchObject({
    records: [],
    references: [],
    parameters: { prompt: '' },
    jobs: [],
  })
  expect(saveImageRecord).not.toHaveBeenCalled()
  expect(serverTasks[0].status).toBe('ready')
})
it('keeps the simple composer free of credential and model controls', async () => {
  showStudio()
  await ready()
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'Image model' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
})

it('fills the prompt from the server-side refinement agent', async () => {
  let finish!: (value: string) => void
  vi.mocked(refinePrompt).mockImplementation(
    async (_prompt, _signal) =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  showStudio()
  await ready()
  const prompt = screen.getByRole('textbox', { name: 'Image prompt' })
  fireEvent.change(prompt, { target: { value: 'A cat by a window' } })
  const refineButton = screen.getByRole('button', { name: 'Refine prompt' })
  fireEvent.click(refineButton)
  await screen.findByRole('button', { name: 'Refining...' })
  expect(refineButton).toHaveAttribute('aria-busy', 'true')
  await act(async () => finish('A polished studio prompt'))
  await waitFor(() => expect(prompt).toHaveValue('A polished studio prompt'))
  expect(refineButton).toHaveAttribute('aria-busy', 'false')
  expect(refinePrompt).toHaveBeenCalledWith(
    'A cat by a window',
    expect.any(AbortSignal)
  )
})

it('aborts prompt refinement when the authenticated session changes', async () => {
  let finish!: (value: string) => void
  let requestSignal!: AbortSignal
  vi.mocked(refinePrompt).mockImplementation((_prompt, signal) => {
    requestSignal = signal as AbortSignal
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  showStudio()
  await ready()
  const prompt = screen.getByRole('textbox', { name: 'Image prompt' })
  fireEvent.change(prompt, { target: { value: 'A private idea' } })
  fireEvent.click(screen.getByRole('button', { name: 'Refine prompt' }))
  await screen.findByRole('button', { name: 'Refining...' })

  act(() => useAuthStore.getState().auth.reset())
  expect(requestSignal.aborted).toBe(true)
  await act(async () => finish('A stale refined prompt'))

  expect(useImagePlaygroundStore.getState().parameters.prompt).toBe('')
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue('')
})

it('reports storage failure while keeping generated images available for download', async () => {
  vi.mocked(saveImageRecord).mockRejectedValue(new Error('quota exceeded'))
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A mountain lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  expect(
    await screen.findByText(
      'Local storage is unavailable or full. Download your images before leaving.'
    )
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
})

it('stops a request without retrying and restores submission with a charge-status explanation', async () => {
  vi.mocked(createStudioTask).mockImplementation(
    (_id, _parameters, _references, _metadata, signal) => {
      const requestSignal = signal as unknown as AbortSignal
      return new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        )
      })
    }
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A mountain lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByRole('button', { name: 'Stop waiting' })
  expect(
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
  ).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The provider may still finish and charge'
  )
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  expect(
    window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
  ).toBe(true)
  expect(createStudioTask).toHaveBeenCalledTimes(1)
})

it('shows output settings together and prevents a transparent JPEG request', async () => {
  showStudio()
  await ready()
  expect(
    screen.queryByRole('button', { name: 'Advanced settings' })
  ).not.toBeInTheDocument()
  const background = await screen.findByRole('combobox', {
    name: 'Image background',
  })
  fireEvent.change(background, { target: { value: 'transparent' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'File format' }), {
    target: { value: 'jpeg' },
  })
  expect(background).toBeDisabled()
  expect(background).toHaveValue('auto')
})

it('allows viewing an older creation while a new request is in progress', async () => {
  vi.mocked(readImageHistory).mockResolvedValue([
    {
      id: 'old-record',
      ownerId: 1,
      createdAt: 1,
      parameters: {
        ...useImagePlaygroundStore.getState().parameters,
        model: 'gpt-image-2',
        prompt: 'An older forest',
      },
      images: [image],
      referenceCount: 0,
    },
  ])
  acceptPendingTasks()
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A new mountain' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByText('Creating...')
  expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Continue editing' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Reuse settings' })).toBeEnabled()
  await act(async () => updateTask(0, { status: 'ready' }))
})

it('keeps the original creation settings when another image finishes during an open preview', async () => {
  vi.mocked(readImageHistory).mockResolvedValue([
    {
      id: 'old-record',
      ownerId: 1,
      createdAt: 1,
      parameters: {
        ...useImagePlaygroundStore.getState().parameters,
        model: 'gpt-image-2',
        prompt: 'An older forest',
      },
      images: [image],
      referenceCount: 0,
    },
  ])
  vi.spyOn(imageFiles, 'getImageBlob').mockResolvedValue(
    new Blob(['img'], { type: 'image/png' })
  )
  acceptPendingTasks()
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A new mountain' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByText('Creating...')
  fireEvent.click(screen.getByRole('button', { name: 'Image Preview' }))
  const dialog = await screen.findByRole('dialog')
  await act(async () => updateTask(0, { status: 'ready' }))
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Continue editing' })
  )
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().parameters.prompt).toBe(
      'An older forest'
    )
  )
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue(
    'An older forest'
  )
})

it.each([
  { resolution: '4K', ratio: '2:3', size: '2304x3456' },
  { resolution: '4K', ratio: '16:9', size: '3840x2160' },
  { resolution: '4K', ratio: '1:1', size: '2880x2880' },
  { resolution: '2K', ratio: '21:9', size: '2560x1088' },
])(
  'sends the exact $size dimensions when $resolution and $ratio are selected',
  async ({ resolution, ratio, size }) => {
    showStudio()
    await ready()
    expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: resolution }))
    fireEvent.click(screen.getByRole('button', { name: ratio }))
    expect(screen.getByRole('button', { name: resolution })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
      target: { value: 'A mountain' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() =>
      expect(createStudioTask).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ size }),
        [],
        expect.any(Object),
        expect.any(AbortSignal)
      )
    )
  }
)

it('keeps the built-in image model stable while changing advanced output settings', async () => {
  showStudio()
  await ready()
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2'
  )
  fireEvent.click(screen.getByRole('button', { name: '4K' }))
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2'
  )
})

it('previews a reference on hover and closes it on leave without opening a dialog', async () => {
  const user = userEvent.setup()
  showStudio()
  await ready()
  fireEvent.change(screen.getByLabelText(/Reference images/), {
    target: {
      files: [new File(['one'], 'reference.png', { type: 'image/png' })],
    },
  })
  const trigger = screen.getByRole('button', {
    name: 'Preview reference reference.png',
  })
  await user.hover(trigger)
  const preview = await screen.findByRole('img', {
    name: 'Preview reference reference.png',
  })
  expect(preview).toHaveAttribute('src', 'blob:reference')
  await user.click(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.unhover(trigger)
  await waitFor(() =>
    expect(
      screen.queryByRole('img', { name: 'Preview reference reference.png' })
    ).not.toBeInTheDocument()
  )
  expect(useImagePlaygroundStore.getState().references[0].file.name).toBe(
    'reference.png'
  )
})

it('opens reference previews with keyboard focus and dismisses them with Escape', async () => {
  const user = userEvent.setup()
  showStudio()
  await ready()
  fireEvent.change(screen.getByLabelText(/Reference images/), {
    target: {
      files: [new File(['one'], 'reference.png', { type: 'image/png' })],
    },
  })
  const trigger = screen.getByRole('button', {
    name: 'Preview reference reference.png',
  })
  act(() => trigger.focus())
  expect(
    await screen.findByRole('img', { name: 'Preview reference reference.png' })
  ).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(
      screen.queryByRole('img', { name: 'Preview reference reference.png' })
    ).not.toBeInTheDocument()
  )
  expect(trigger).toHaveFocus()
})

it('returns to automatic sizing from the dock after choosing a ratio and resolution', async () => {
  showStudio()
  await ready()
  fireEvent.click(screen.getByRole('button', { name: '16:9' }))
  expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  fireEvent.click(screen.getByRole('button', { name: '4K' }))
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Aspect ratio' })).getByRole(
      'button',
      { name: 'Auto' }
    )
  )
  expect(
    within(screen.getByRole('group', { name: 'Aspect ratio' })).getByRole(
      'button',
      { name: 'Auto' }
    )
  ).toHaveAttribute('aria-pressed', 'true')
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A coastal house' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() =>
    expect(createStudioTask).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ size: 'auto' }),
      [],
      expect.any(Object),
      expect.any(AbortSignal)
    )
  )
})

it('reuses the user prompt and selected style without applying the template twice', async () => {
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A perfume bottle' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), {
    target: { value: 'product' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reuse settings' }))
  expect(screen.getByRole('combobox', { name: 'Style' })).toHaveValue('product')
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue(
    'A perfume bottle'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(createStudioTask).toHaveBeenCalledTimes(2))
  expect(createStudioTask).toHaveBeenNthCalledWith(
    2,
    expect.any(String),
    vi.mocked(createStudioTask).mock.calls[0][1],
    [],
    expect.any(Object),
    expect.any(AbortSignal)
  )
})

it.each(stylePresets)(
  'hides the $id template from legacy history, copied prompts, and reused drafts',
  async (preset) => {
    const user = userEvent.setup()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const original = '西游记四人同行，手绘水彩，warm light'
    vi.mocked(readImageHistory).mockResolvedValue([
      {
        id: 'legacy',
        ownerId: 1,
        createdAt: 1,
        parameters: {
          ...useImagePlaygroundStore.getState().parameters,
          prompt: applyStyleTemplate(original, preset.promptTemplate),
        },
        images: [image],
        referenceCount: 0,
      },
    ])
    showStudio()
    expect(await screen.findByText(original)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Image prompt' }))
    const popup = await screen.findByRole('dialog', { name: 'Image prompt' })
    expect(
      within(popup).getByText(original, { exact: true })
    ).toBeInTheDocument()
    await user.click(within(popup).getByRole('button', { name: 'Copy prompt' }))
    expect(write).toHaveBeenCalledWith(original)
    await user.keyboard('{Escape}')
    fireEvent.click(screen.getByRole('button', { name: 'Reuse settings' }))
    expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue(
      original
    )
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveValue(
      preset.id
    )
  }
)

it.each([
  {
    styleId: undefined,
    original:
      'Portrait of a traveler. Soft natural light. No text, no logo, no watermark.',
  },
  {
    styleId: null,
    original: applyStyleTemplate('A traveler', stylePresets[1].promptTemplate),
  },
])(
  'preserves user-written English with saved style $styleId',
  async ({ styleId, original }) => {
    vi.mocked(readImageHistory).mockResolvedValue([
      {
        id: 'english',
        ownerId: 1,
        createdAt: 1,
        styleId,
        parameters: {
          ...useImagePlaygroundStore.getState().parameters,
          prompt: original,
        },
        images: [image],
        referenceCount: 0,
      },
    ])
    showStudio()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Reuse settings' })
    )
    expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue(
      original
    )
    expect(screen.getByRole('combobox', { name: 'Style' })).toHaveValue('')
  }
)

it('renders large image data without adding an ambient background', async () => {
  const largeImageSource = `data:image/png;base64,${'A'.repeat(2 ** 21)}`
  vi.mocked(readImageHistory).mockResolvedValue([
    {
      id: 'large',
      ownerId: 1,
      createdAt: 1,
      parameters: useImagePlaygroundStore.getState().parameters,
      images: [{ id: 'large', src: largeImageSource }],
      referenceCount: 0,
    },
  ])
  const view = showStudio()
  await ready()
  expect(screen.getByRole('img', { name: 'Generated image' })).toHaveAttribute(
    'src',
    largeImageSource
  )
  expect(view.container.querySelector('.studio-ambient-bg')).toBeNull()
})

it('keeps an empty canvas in the selected interface theme without an artwork layer', async () => {
  const view = showStudio()
  await ready()
  expect(view.container.querySelector('.studio-ambient-bg img')).toBeNull()
  expect(view.container.querySelector('.image-studio')).not.toHaveClass(
    'image-studio--has-art'
  )
})

it('opens the reference hover card on touch and removes it together with the reference', async () => {
  const user = userEvent.setup()
  showStudio()
  await ready()
  fireEvent.change(screen.getByLabelText(/Reference images/), {
    target: {
      files: [new File(['one'], 'reference.png', { type: 'image/png' })],
    },
  })
  const trigger = screen.getByRole('button', {
    name: 'Preview reference reference.png',
  })
  await user.pointer([
    { keys: '[TouchA>]', target: trigger },
    { keys: '[/TouchA]', target: trigger },
  ])
  expect(
    await screen.findByRole('img', { name: 'Preview reference reference.png' })
  ).toBeVisible()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(
    screen.getByRole('button', { name: 'Remove reference reference.png' })
  )
  expect(
    screen.queryByRole('img', { name: 'Preview reference reference.png' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Preview reference reference.png' })
  ).not.toBeInTheDocument()
})

afterEach(() => vi.unstubAllGlobals())

it('caches server image bytes and reads the local copy after server expiry', async () => {
  const view = showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() =>
    expect(saveImageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        localSaveStatus: 'saved',
        images: [expect.objectContaining({ src: image.src })],
      })
    )
  )
  const saved = vi.mocked(saveImageRecord).mock.calls.at(-1)?.[0]
  if (!saved) throw new Error('Expected a saved image record')
  expect(api.get).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/image-playground\/tasks\/.+\/images\/0$/),
    expect.objectContaining({ responseType: 'blob' })
  )
  view.unmount()
  act(() =>
    useImagePlaygroundStore.setState({ records: [], historyLoaded: false })
  )
  vi.mocked(readImageHistory).mockResolvedValue([saved])
  serverTasks = []
  vi.mocked(api.get).mockRejectedValue(new Error('server copy expired'))
  showStudio()
  expect(await screen.findByAltText('Generated image')).toHaveAttribute(
    'src',
    saved.images[0].previewSrc ?? saved.images[0].src
  )
})
it('saves accessible legacy links on history load without changing their settings', async () => {
  const record = {
    id: 'legacy-url',
    ownerId: 1,
    createdAt: 1,
    parameters: {
      ...useImagePlaygroundStore.getState().parameters,
      prompt: 'A lake',
    },
    images: [{ id: 'legacy-image', src: 'https://images.example/legacy.webp' }],
    referenceCount: 0,
  }
  vi.mocked(readImageHistory).mockResolvedValue([record])
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['legacy'], { type: 'image/webp' }),
    })
  )
  showStudio()
  await waitFor(() =>
    expect(saveImageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        id: record.id,
        parameters: record.parameters,
        images: [
          expect.objectContaining({
            id: 'legacy-image',
            src: 'data:image/webp;base64,bGVnYWN5',
          }),
        ],
      }),
      true
    )
  )
  expect(screen.getByAltText('Generated image')).toHaveAttribute(
    'src',
    'data:image/webp;base64,bGVnYWN5'
  )
})

it('keeps cached originals when another server image download fails', async () => {
  vi.mocked(createStudioTask).mockImplementation(
    async (id, _parameters, _references, metadata) => {
      const task = taskFixture(id, metadata)
      task.images.push({ ...task.images[0], index: 1 })
      serverTasks.push(task)
      return task
    }
  )
  vi.mocked(api.get).mockImplementation(async (url) => {
    if (url.endsWith('/1')) throw new Error('download interrupted')
    return { data: new Blob(['image'], { type: 'image/png' }) }
  })
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByText(
    'Some images could not be saved locally. Download them before their links expire.'
  )
  const saved = vi.mocked(saveImageRecord).mock.calls.at(-1)?.[0]
  expect(saved?.images.map((item) => item.src)).toEqual([
    image.src,
    expect.stringMatching(/\/images\/1$/),
  ])
  expect(screen.getByRole('button', { name: 'Retry download' })).toBeEnabled()
  expect(screen.queryByText('Creation interrupted')).not.toBeInTheDocument()
})
it('discards local image downloads when the account changes', async () => {
  let finish!: (value: { data: Blob }) => void
  vi.mocked(api.get).mockImplementation((url) =>
    url.includes('thumbnail')
      ? Promise.resolve({ data: new Blob(['preview'], { type: 'image/jpeg' }) })
      : new Promise((resolve) => {
          finish = resolve
        })
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  const previousSaves = vi.mocked(saveImageRecord).mock.calls.length
  act(() => useAuthStore.getState().auth.reset())
  await act(async () =>
    finish({ data: new Blob(['image'], { type: 'image/png' }) })
  )
  expect(saveImageRecord).toHaveBeenCalledTimes(previousSaves)
  expect(useImagePlaygroundStore.getState().records).toEqual([])
})
it('accepts a second generation while the first is pending and keeps each result', async () => {
  acceptPendingTasks()
  showStudio()
  await ready()
  for (const prompt of ['First creation', 'Second creation']) {
    fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
      target: { value: prompt },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() =>
      expect(
        serverTasks.some((task) => task.metadata.parameters.prompt === prompt)
      ).toBe(true)
    )
  }
  await act(async () => updateTask(1, { status: 'ready' }))
  await act(async () => updateTask(0, { status: 'ready' }))
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().records).toHaveLength(2)
  )
  expect(
    useImagePlaygroundStore
      .getState()
      .records.map((record) => record.parameters.prompt)
      .sort()
  ).toEqual(['First creation', 'Second creation'])
})
it('translates a rejected submission and preserves the draft for retry', async () => {
  i18next.addResource(
    'zh',
    'translation',
    'invalid image task request',
    '图片任务请求无效'
  )
  await i18next.changeLanguage('zh')
  try {
    vi.mocked(createStudioTask).mockRejectedValue(
      new Error('invalid image task request')
    )
    showStudio()
    await ready()
    fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
      target: { value: 'A lake' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '图片任务请求无效'
    )
    expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue(
      'A lake'
    )
    expect(createStudioTask).toHaveBeenCalledTimes(1)
  } finally {
    await i18next.changeLanguage('en')
  }
})

it('keeps the remaining job running when one of two parallel requests fails', async () => {
  acceptPendingTasks()
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'First' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(serverTasks).toHaveLength(1))
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'high' },
  })
  fireEvent.click(screen.getByRole('button', { name: '4K' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'Second' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(serverTasks).toHaveLength(2))
  await act(async () =>
    updateTask(0, { status: 'failed', error: 'First request failed' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'First request failed'
  )
  expect(screen.getAllByText('Creating...')).toHaveLength(1)
  await act(async () => updateTask(1, { status: 'ready' }))
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().records).toHaveLength(1)
  )
  expect(
    useImagePlaygroundStore.getState().records[0].parameters
  ).toMatchObject({ group: 'high', size: '4096x4096', prompt: 'Second' })
  expect(createStudioTask).toHaveBeenNthCalledWith(
    1,
    expect.any(String),
    expect.objectContaining({
      group: 'native',
      size: '2880x2880',
      prompt: 'First',
    }),
    [],
    expect.any(Object),
    expect.any(AbortSignal)
  )
})
it('removes expired server tasks and allows another generation after synchronization', async () => {
  acceptPendingTasks()
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'An expired creation' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByText('Creating...')
  serverTasks = []
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['image-studio-tasks'] })
  })
  await waitFor(() =>
    expect(screen.queryByText('Creating...')).not.toBeInTheDocument()
  )
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
})

it('limits active requests to four and permits another after one completes', async () => {
  acceptPendingTasks()
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'Four parallel images' },
  })
  for (let index = 1; index <= 4; index++) {
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() => expect(serverTasks).toHaveLength(index))
  }
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toBeEnabled()
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Image prompt' }), {
    key: 'Enter',
    ctrlKey: true,
  })
  expect(createStudioTask).toHaveBeenCalledTimes(4)
  await act(async () => updateTask(0, { status: 'ready' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  )
})
it('preserves a newly edited draft when prompt refinement finishes', async () => {
  let resolve!: (prompt: string) => void
  vi.mocked(refinePrompt).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'Original' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Refine prompt' }))
  await screen.findByRole('button', { name: 'Refining...' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'New idea' },
  })
  await act(async () => resolve('Refined original'))
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue(
    'New idea'
  )
})

it('shows the gray recharge estimate below generate and updates it for group, model and count', async () => {
  showStudio()
  await ready()
  expect(await screen.findByText('Estimated cost ¥0.225')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'high' },
  })
  expect(await screen.findByText('Estimated cost ¥0.12')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Image count' }), {
    target: { value: '4' },
  })
  expect(await screen.findByText('Estimated cost ¥0.48')).toBeInTheDocument()
  await selectModel('gpt-image-2.5')
  expect(screen.getByText('Estimated cost ¥0.48')).toBeInTheDocument()
})

it('shows unavailable instead of a made-up zero when pricing cannot be loaded', async () => {
  vi.mocked(getPricing).mockRejectedValueOnce(new Error('Offline'))
  showStudio()
  await ready()
  expect(
    await screen.findByText('Cost estimate unavailable')
  ).toBeInTheDocument()
  expect(screen.queryByText('Estimated cost ¥0.00')).not.toBeInTheDocument()
})

it('shows a per-image price at the right of each model even when the draft requests four images', async () => {
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'high' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Image count' }), {
    target: { value: '4' },
  })
  await userEvent.click(screen.getByRole('combobox', { name: 'Model' }))
  for (const option of within(screen.getByRole('listbox')).getAllByRole(
    'option'
  )) {
    expect(await within(option).findByText('¥0.12/image')).toHaveClass(
      'text-muted-foreground'
    )
    expect(within(option).queryByText('¥0.48/image')).not.toBeInTheDocument()
  }
})

it('selecting an inspiration preserves the draft and keeps focus outside the composer', async () => {
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A bottle' },
  })
  const inspiration = screen.getByRole('button', {
    name: 'Try Product photography',
  })
  inspiration.focus()
  fireEvent.click(inspiration)
  expect(screen.getByRole('combobox', { name: 'Style' })).toHaveValue('product')
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveValue(
    'A bottle'
  )
  expect(inspiration).toHaveFocus()
})

it('offers every style in the same order as the composer and keeps both selectors synchronized', async () => {
  showStudio()
  await ready()
  const selector = screen.getByRole('combobox', { name: 'Style' })
  const options = [...selector.querySelectorAll('option')].filter(
    (option) => option.value
  )
  const cards = screen.getAllByRole('button', { name: /^Try / })
  expect(cards).toHaveLength(options.length)
  for (const [index, option] of options.entries()) {
    const card = cards[index]
    expect(card).toHaveAccessibleName(`Try ${option.textContent}`)
    fireEvent.click(card)
    expect(selector).toHaveValue(option.value)
    expect(card).toHaveAttribute('aria-pressed', 'true')
  }
  fireEvent.change(selector, { target: { value: 'portrait' } })
  expect(screen.getByRole('button', { name: 'Try Portrait' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(
    screen.getByRole('button', { name: 'Try Concept art' })
  ).toHaveAttribute('aria-pressed', 'false')
})

it('keeps the selected style example visible in the composer when creations replace the inspiration gallery', async () => {
  vi.mocked(readImageHistory).mockResolvedValue([
    {
      id: 'existing-creation',
      ownerId: 1,
      createdAt: 1,
      parameters: {
        ...useImagePlaygroundStore.getState().parameters,
        prompt: 'My saved artwork',
      },
      images: [image],
      referenceCount: 0,
    },
  ])
  showStudio()
  await ready()
  await screen.findByText('My saved artwork')
  expect(
    screen.queryByRole('group', { name: 'Style inspiration' })
  ).not.toBeInTheDocument()
  const selector = screen.getByRole('combobox', { name: 'Style' })
  fireEvent.change(selector, { target: { value: 'product' } })
  expect(
    screen.getByRole('img', { name: 'Product photography' })
  ).toHaveAttribute('src', '/style-previews/product.jpg')
  fireEvent.change(selector, { target: { value: 'watercolor' } })
  expect(screen.getByRole('img', { name: 'Watercolor' })).toHaveAttribute(
    'src',
    '/style-previews/watercolor.jpg'
  )
  expect(
    screen.queryByRole('img', { name: 'Product photography' })
  ).not.toBeInTheDocument()
  fireEvent.change(selector, { target: { value: '' } })
  expect(
    screen.queryByRole('img', { name: 'Watercolor' })
  ).not.toBeInTheDocument()
  expect(createStudioTask).not.toHaveBeenCalled()
})

it('opens the selected style example from the composer without submitting a generation', async () => {
  const user = userEvent.setup()
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('combobox', { name: 'Style' }), {
    target: { value: 'watercolor' },
  })
  const style = screen.getByRole('group', { name: 'Style' })
  const preview = within(style).getByRole('button', {
    name: 'Style inspiration',
  })
  preview.focus()
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog', { name: 'Watercolor' })
  expect(within(dialog).getByRole('img')).toHaveAttribute(
    'src',
    '/style-previews/watercolor.jpg'
  )
  await user.keyboard('{Escape}')
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
  expect(preview).toHaveFocus()
  expect(createStudioTask).not.toHaveBeenCalled()
})

it('uses one image group and changes size limits and pricing controls with the model', async () => {
  vi.mocked(getStudioGroups).mockResolvedValueOnce([
    {
      id: '画图',
      name: 'Image generation',
      description: '',
      ratio: 1,
      available: true,
      models: [
        'mj-v8.2',
        'gemini-nano-banana-2.1',
        'gpt-image-2.5-sunburst-native',
        'gpt-image-2.6-basic',
        'gpt-image-2.6-flare-basic',
        'gpt-image-2.6-sunburst-basic',
        'gpt-image-2.6-flare-native',
        'gpt-image-2.6-sunburst-native',
        'gpt-image-2-basic',
        'gpt-image-2-native',
        'gpt-image-2.5-flare-basic',
        'gpt-image-2.5-flare-native',
        'gpt-image-2.5-sunburst-basic',
        'gemini-3-pro-image',
        'gemini-3-pro-image-preview',
        'gemini-3.1-flash-image',
        'gemini-3.1-flash-image-preview',
        'gemini-2.5-flash-image',
      ],
      size_mode: 'upscale',
      max_resolution: 8,
      model_profiles: {
        'gpt-image-2-basic': { size_mode: 'upscale', max_resolution: 4 },
        'gpt-image-2-native': { size_mode: 'native', max_resolution: 4 },
        'gemini-3-pro-image-preview': {
          size_mode: 'upscale',
          max_resolution: 4,
        },
        'mj-v8.2': { size_mode: 'ratio', max_resolution: 0 },
      },
    },
  ])
  useImagePlaygroundStore
    .getState()
    .setParameters({ group: '画图', model: 'gpt-image-2-basic' })
  showStudio()
  const model = await screen.findByRole('combobox', { name: 'Model' })
  await waitFor(() => expect(model).toHaveTextContent('GPT Image 2'))
  expect(
    screen.queryByRole('combobox', { name: 'Generation group' })
  ).not.toBeInTheDocument()
  const information = screen.getByLabelText('Selected model information')
  expect(
    model.compareDocumentPosition(information) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy()
  await userEvent.click(model)
  expect(screen.getByText('Banana')).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { level: 3, name: 'GPT Image' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { level: 4, name: 'Upscaled images' })
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { level: 4, name: 'Native images' })
  ).toBeInTheDocument()
  const gptOptions = screen
    .getAllByRole('option')
    .filter((option) =>
      option.getAttribute('data-value')?.startsWith('gpt-image-')
    )
  expect(gptOptions.map((option) => option.getAttribute('data-value'))).toEqual(
    [
      'gpt-image-2-basic',
      'gpt-image-2.5-flare-basic',
      'gpt-image-2.5-sunburst-basic',
      'gpt-image-2.6-basic',
      'gpt-image-2.6-flare-basic',
      'gpt-image-2.6-sunburst-basic',
      'gpt-image-2-native',
      'gpt-image-2.5-flare-native',
      'gpt-image-2.5-sunburst-native',
      'gpt-image-2.6-flare-native',
      'gpt-image-2.6-sunburst-native',
    ]
  )
  const options = within(screen.getByRole('listbox')).getAllByRole('option')
  expect(options.slice(0, 11)).toEqual(gptOptions)
  expect(options.at(-1)).toHaveAttribute('data-value', 'mj-v8.2')
  const headings = within(screen.getByRole('listbox')).getAllByRole('heading')
  expect(headings.map((heading) => heading.textContent)).toEqual([
    'GPT Image',
    'Upscaled images',
    'Native images',
    'Banana',
    'Midjourney',
  ])
  expect(gptOptions[0]).toHaveTextContent(
    'Low-cost upscaled images for everyday creation and reference composition.'
  )
  expect(gptOptions[6]).toHaveTextContent(
    'Native output for detailed image editing and reference composition.'
  )
  expect(screen.getByText('Midjourney')).toBeInTheDocument()
  expect(
    within(screen.getByRole('option', { name: /Midjourney v8.2/ })).getByText(
      'Midjourney for stylized composition and illustration.'
    )
  ).toBeInTheDocument()
  for (const name of [
    'gemini-nano-banana-2.1',
    'gemini-3-pro-image',
    'gemini-3-pro-image-preview',
    'gemini-3.1-flash-image',
    'gemini-3.1-flash-image-preview',
    'gemini-2.5-flash-image',
  ]) {
    expect(
      screen
        .getAllByRole('option')
        .some((item) => item.getAttribute('data-value') === name)
    ).toBe(true)
  }
  await userEvent.type(
    screen.getByPlaceholderText('Search models...'),
    'gemini-2.5'
  )
  expect(
    within(screen.getByRole('listbox')).getAllByRole('option')
  ).toHaveLength(1)
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('button', { name: '8K' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '16:9' }))
  await selectModel('gpt-image-2-native')
  expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  expect(useImagePlaygroundStore.getState().parameters.size).toBe('3840x2160')
  await selectModel('gemini-3-pro-image-preview')
  expect(
    screen.queryByRole('combobox', { name: 'Quality' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'Image background' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('combobox', { name: 'File format' })
  ).not.toBeInTheDocument()
  await selectModel('mj-v8.2')
  expect(useImagePlaygroundStore.getState().parameters.size).toBe('16:9')
  expect(
    screen.queryByRole('group', { name: 'Resolution' })
  ).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Per request' })).toHaveValue('1')
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toHaveAttribute(
    'maxlength',
    '1023'
  )
})

it('maps a reused legacy group to its matching model alias without changing the draft or resolution', async () => {
  vi.mocked(getStudioGroups).mockResolvedValueOnce([
    {
      id: '画图',
      name: 'Image generation',
      description: '',
      ratio: 1,
      available: true,
      models: ['gpt-image-2-basic'],
      size_mode: 'upscale',
      max_resolution: 8,
    },
  ])
  useImagePlaygroundStore.getState().setParameters({
    group: '【生图】超分高质量1-10k',
    model: 'gpt-image-2',
    prompt: 'An existing draft',
    size: '2048x2048',
  })
  showStudio()
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().parameters.group).toBe('画图')
  )
  expect(useImagePlaygroundStore.getState().parameters).toMatchObject({
    model: 'gpt-image-2-basic',
    prompt: 'An existing draft',
    size: '2048x2048',
  })
})

it.each(['【生图】超分高质量1-10k', '画图'])(
  'reuses an 8K advanced draft from %s as upscaled 4K with its ratio intact',
  async (group) => {
    vi.mocked(getStudioGroups).mockResolvedValueOnce([
      {
        id: '画图',
        name: 'Image generation',
        description: '',
        ratio: 1,
        available: true,
        models: ['gpt-image-2.5-basic', 'gpt-image-2-basic'],
        size_mode: 'upscale',
        max_resolution: 4,
      },
    ])
    useImagePlaygroundStore.getState().setParameters({
      group,
      model: group === '画图' ? 'gpt-image-2-hq' : 'gpt-image-2',
      prompt: 'Retain this draft',
      size: '8192x4608',
    })
    showStudio()
    await waitFor(() =>
      expect(useImagePlaygroundStore.getState().parameters.group).toBe('画图')
    )
    await waitFor(() =>
      expect(useImagePlaygroundStore.getState().parameters.model).toBe(
        'gpt-image-2-basic'
      )
    )
    expect(useImagePlaygroundStore.getState().parameters.size).toBe('4096x2304')
    expect(screen.getByRole('button', { name: '16:9' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(screen.getByRole('button', { name: '4K' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  }
)
