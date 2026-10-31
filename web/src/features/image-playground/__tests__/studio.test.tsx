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
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { getPricing } from '@/features/pricing/api'
import { useAuthStore } from '@/stores/auth-store'

import {
  generateImages,
  getPlaygroundAgentConfig,
  getStudioGroups,
  refinePrompt,
  savePlaygroundAgentConfig,
} from '../api'
import { ImagePlayground } from '../index'
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
  generateImages: vi.fn(),
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
      size_mode: 'native',
      available: true,
    },
    {
      id: 'high',
      name: 'High resolution',
      description: 'High resolution',
      ratio: 1.2,
      models: ['gpt-image-2', 'gpt-image-2.5'],
      max_resolution: 4,
      size_mode: 'native',
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
  vi.mocked(generateImages).mockResolvedValue([image])
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

it('starts without a key setup dialog and exposes the selected group models', async () => {
  vi.mocked(getPlaygroundAgentConfig).mockResolvedValueOnce({
    prompt: null,
    image: null,
  })
  showStudio()
  await ready()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), {
    target: { value: 'gpt-image-2.5-flare' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'high' },
  })
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue(
    'gpt-image-2'
  )
  expect(
    screen.queryByRole('option', { name: 'gpt-image-2.5-flare' })
  ).not.toBeInTheDocument()
  for (const resolution of ['6K', '8K', '10K']) {
    expect(
      screen.queryByRole('button', { name: resolution })
    ).not.toBeInTheDocument()
  }
  fireEvent.click(screen.getByRole('button', { name: '4K' }))
  expect(useImagePlaygroundStore.getState().parameters.size).toBe('2880x2880')
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'basic' },
  })
  expect(screen.queryByRole('button', { name: '10K' })).not.toBeInTheDocument()
  expect(useImagePlaygroundStore.getState().parameters.size).toBe('auto')
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
  expect(generateImages).toHaveBeenCalledTimes(1)
  expect(generateImages).toHaveBeenCalledWith(
    expect.objectContaining({
      prompt: expect.stringContaining('画一只猫 placed on'),
    }),
    [],
    expect.any(AbortSignal)
  )
  expect(screen.getByRole('combobox', { name: 'Style' })).toHaveValue('product')
  expect(saveImageRecord).toHaveBeenCalledWith(
    expect.objectContaining({
      ownerId: 1,
      referenceCount: 0,
      images: [image],
      styleId: 'product',
      parameters: expect.objectContaining({ prompt: '画一只猫' }),
    })
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
    expect(generateImages).not.toHaveBeenCalled()
    expect(prompt).toHaveValue('画一只猫')

    fireEvent.compositionEnd(prompt, { data: '猫' })
    fireEvent.keyDown(prompt, { key: 'Enter', ctrlKey: true, keyCode: 13 })
    await waitFor(() =>
      expect(generateImages).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: '画一只猫' }),
        [],
        expect.any(AbortSignal)
      )
    )
    expect(generateImages).toHaveBeenCalledTimes(1)
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
    expect(generateImages).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '画 你的 风景' }),
      [],
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
  expect(generateImages).not.toHaveBeenCalled()
  fireEvent.change(prompt, { target: { value: '画一只猫\n坐在窗' } })
  fireEvent.change(prompt, { target: { value: '' } })
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  fireEvent.change(prompt, { target: { value: '画一只猫\n坐在窗' } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() =>
    expect(generateImages).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '画一只猫\n坐在窗',
        size: '1536x1024',
      }),
      [],
      expect.any(AbortSignal)
    )
  )
})

it('keeps submission available during a request and preserves its result after returning', async () => {
  let finish!: (value: (typeof image)[]) => void
  vi.mocked(generateImages).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const view = showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A mountain lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByText('Creating...')
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  view.unmount()
  await act(async () => finish([image]))
  showStudio()
  expect(
    await screen.findByRole('button', { name: 'Continue editing' })
  ).toBeEnabled()
  expect(generateImages).toHaveBeenCalledTimes(1)
})

it('shows API failure once and keeps the draft for an explicit retry', async () => {
  vi.mocked(generateImages).mockRejectedValue(new Error('Insufficient quota'))
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
  expect(generateImages).toHaveBeenCalledTimes(1)
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
    expect(generateImages).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Keep the scene, make it snowy' }),
      [files[1]],
      expect.any(AbortSignal)
    )
  )
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference')
})

it('cancels the pending job and drops drafts, references and late results on logout', async () => {
  let finish!: (value: (typeof image)[]) => void
  vi.mocked(generateImages).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
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
  const signal = vi.mocked(generateImages).mock
    .calls[0][2] as unknown as AbortSignal
  act(() => useAuthStore.getState().auth.reset())
  expect(signal.aborted).toBe(true)
  await act(async () => finish([image]))
  expect(useImagePlaygroundStore.getState()).toMatchObject({
    records: [],
    references: [],
    parameters: { prompt: '' },
    jobs: [],
  })
  expect(saveImageRecord).not.toHaveBeenCalled()
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
  vi.mocked(generateImages).mockImplementation(
    (_parameters, _references, signal) => {
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
  expect(generateImages).toHaveBeenCalledTimes(1)
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
  let finish!: (value: (typeof image)[]) => void
  vi.mocked(generateImages).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A new mountain' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByRole('button', { name: 'Stop waiting' })
  expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Continue editing' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Reuse settings' })).toBeEnabled()
  await act(async () => finish([image]))
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
  let finish!: (value: (typeof image)[]) => void
  vi.mocked(generateImages).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A new mountain' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByRole('button', { name: 'Stop waiting' })
  fireEvent.click(screen.getByRole('button', { name: 'Image Preview' }))
  const dialog = await screen.findByRole('dialog')
  await act(async () => finish([{ ...image, id: 'new-image' }]))
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
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Generation group' }),
      {
        target: { value: 'high' },
      }
    )
    expect(
      within(screen.getByRole('group', { name: 'Aspect ratio' })).getByRole(
        'button',
        { name: 'Auto' }
      )
    ).toHaveAttribute('aria-pressed', 'true')
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
      expect(generateImages).toHaveBeenCalledWith(
        expect.objectContaining({ size }),
        [],
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
  expect(screen.getByRole('button', { name: '1K' })).toHaveAttribute(
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
    expect(generateImages).toHaveBeenCalledWith(
      expect.objectContaining({ size: 'auto' }),
      [],
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
  await waitFor(() => expect(generateImages).toHaveBeenCalledTimes(2))
  expect(generateImages).toHaveBeenNthCalledWith(
    2,
    vi.mocked(generateImages).mock.calls[0][0],
    [],
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

it('stores URL image bytes locally and displays the saved copy after history is reloaded', async () => {
  const remote = { id: 'remote', src: 'https://images.example/temporary.png' }
  vi.mocked(generateImages).mockResolvedValue([remote])
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['image bytes'], { type: 'image/png' }),
    })
  )
  const view = showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() =>
    expect(saveImageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [{ ...remote, src: 'data:image/png;base64,aW1hZ2UgYnl0ZXM=' }],
      })
    )
  )
  const saved = vi.mocked(saveImageRecord).mock.calls.at(-1)?.[0]
  if (!saved) throw new Error('Expected saved image history')
  expect(fetch).toHaveBeenCalledWith(
    remote.src,
    expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
  )
  view.unmount()
  act(() =>
    useImagePlaygroundStore.setState({ records: [], historyLoaded: false })
  )
  vi.mocked(readImageHistory).mockResolvedValue([saved])
  vi.mocked(fetch).mockRejectedValue(new Error('link expired'))
  showStudio()
  expect(await screen.findByAltText('Generated image')).toHaveAttribute(
    'src',
    saved.images[0].src
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
          { id: 'legacy-image', src: 'data:image/webp;base64,bGVnYWN5' },
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

it('retains successful local copies and warns when another temporary link cannot be saved', async () => {
  vi.mocked(generateImages).mockResolvedValue([
    { id: 'available', src: 'https://images.example/available.png' },
    { id: 'blocked', src: 'https://images.example/blocked.png' },
  ])
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('blocked')) throw new TypeError('CORS blocked')
      return {
        ok: true,
        blob: async () => new Blob(['image'], { type: 'image/png' }),
      }
    })
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  expect(
    await screen.findByText(
      'Some images could not be saved locally. Download them before their links expire.'
    )
  ).toBeInTheDocument()
  expect(
    vi
      .mocked(saveImageRecord)
      .mock.calls.at(-1)?.[0]
      .images.map((item) => item.src)
  ).toEqual([
    'data:image/png;base64,aW1hZ2U=',
    'https://images.example/blocked.png',
  ])
  expect(screen.queryByText('Creation interrupted')).not.toBeInTheDocument()
})

it('discards local image downloads when the account changes', async () => {
  let finish!: (value: unknown) => void
  vi.mocked(generateImages).mockResolvedValue([
    { id: 'remote', src: 'https://images.example/temporary.png' },
  ])
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A lake' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(fetch).toHaveBeenCalled())
  act(() => useAuthStore.getState().auth.reset())
  await act(async () =>
    finish({
      ok: true,
      blob: async () => new Blob(['image'], { type: 'image/png' }),
    })
  )
  expect(saveImageRecord).not.toHaveBeenCalled()
  expect(useImagePlaygroundStore.getState().records).toEqual([])
})

it('accepts a second generation while the first is pending and keeps each result', async () => {
  const completions: ((images: (typeof image)[]) => void)[] = []
  vi.mocked(generateImages).mockImplementation(
    () => new Promise((resolve) => completions.push(resolve))
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'First creation' },
  })
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(completions).toHaveLength(1))
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toBeEnabled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'Second creation' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(completions).toHaveLength(2))
  await act(async () => completions[1]([{ ...image, id: 'second' }]))
  await act(async () => completions[0]([{ ...image, id: 'first' }]))
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

it('keeps the remaining job running when one of two parallel requests fails', async () => {
  const pending: {
    resolve: (images: (typeof image)[]) => void
    reject: (error: Error) => void
  }[] = []
  vi.mocked(generateImages).mockImplementation(
    () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'First' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(pending).toHaveLength(1))
  fireEvent.change(screen.getByRole('combobox', { name: 'Generation group' }), {
    target: { value: 'high' },
  })
  fireEvent.click(screen.getByRole('button', { name: '4K' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'Second' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await waitFor(() => expect(pending).toHaveLength(2))
  await act(async () => pending[0].reject(new Error('First request failed')))
  expect(screen.getByRole('alert')).toHaveTextContent('First request failed')
  expect(screen.getAllByRole('button', { name: 'Stop waiting' })).toHaveLength(
    1
  )
  await act(async () => pending[1].resolve([image]))
  await waitFor(() =>
    expect(useImagePlaygroundStore.getState().records).toHaveLength(1)
  )
  expect(
    useImagePlaygroundStore.getState().records[0].parameters
  ).toMatchObject({ group: 'high', size: '2880x2880', prompt: 'Second' })
  expect(generateImages).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ group: 'native', size: 'auto', prompt: 'First' }),
    [],
    expect.any(AbortSignal)
  )
})

it('limits active requests to four and permits another after one completes', async () => {
  const pending: ((images: (typeof image)[]) => void)[] = []
  vi.mocked(generateImages).mockImplementation(
    () => new Promise((resolve) => pending.push(resolve))
  )
  showStudio()
  await ready()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'Four parallel images' },
  })
  for (let index = 1; index <= 4; index++) {
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() => expect(pending).toHaveLength(index))
  }
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  expect(screen.getByRole('textbox', { name: 'Image prompt' })).toBeEnabled()
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Image prompt' }), {
    key: 'Enter',
    ctrlKey: true,
  })
  expect(generateImages).toHaveBeenCalledTimes(4)
  await act(async () => pending[0]([image]))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  )
  for (const resolve of pending.slice(1)) {
    await act(async () => resolve([image]))
  }
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
  fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), {
    target: { value: 'gpt-image-2.5' },
  })
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

it('resets unsupported dimensions when reusing older 10K history', async () => {
  vi.mocked(readImageHistory).mockResolvedValue([
    {
      id: 'legacy-10k',
      ownerId: 1,
      createdAt: Date.now(),
      parameters: {
        ...useImagePlaygroundStore.getState().parameters,
        model: 'gpt-image-2.5',
        group: 'high',
        prompt: 'A mountain',
        size: '10240x5760',
      },
      images: [image],
      referenceCount: 0,
    },
  ])
  showStudio()
  await ready()
  fireEvent.click(await screen.findByRole('button', { name: 'Reuse settings' }))
  expect(useImagePlaygroundStore.getState().parameters).toMatchObject({
    group: 'high',
    model: 'gpt-image-2.5',
    prompt: 'A mountain',
    size: 'auto',
  })
  fireEvent.click(screen.getByRole('button', { name: '4K' }))
  fireEvent.click(screen.getByRole('button', { name: '16:9' }))
  expect(useImagePlaygroundStore.getState().parameters.size).toBe('3840x2160')
})
