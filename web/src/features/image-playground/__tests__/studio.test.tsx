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
import { beforeEach, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { generateImages, refinePrompt } from '../api'
import { ImagePlayground } from '../index'
import { readImageHistory, saveImageRecord } from '../lib/history'
import * as imageFiles from '../lib/images'
import { useImagePlaygroundStore } from '../store'

vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  generateImages: vi.fn(),
  refinePrompt: vi.fn(),
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
  vi.mocked(readImageHistory).mockResolvedValue([])
  vi.mocked(saveImageRecord).mockResolvedValue()
  vi.mocked(generateImages).mockResolvedValue([image])
  vi.mocked(refinePrompt).mockResolvedValue('A polished studio prompt')
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
}

it('requires a prompt, fills an inspiration idea, and generates an actionable creation', async () => {
  showStudio()
  await ready()
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: '画一只猫' },
  })
  fireEvent.click(screen.getByRole('button', { name: /Product photography/ }))
  expect(
    (
      screen.getByRole('textbox', {
        name: 'Image prompt',
      }) as HTMLTextAreaElement
    ).value
  ).toContain('perfume')
  fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
  await screen.findByRole('button', { name: 'Continue editing' })
  expect(generateImages).toHaveBeenCalledTimes(1)
  expect(saveImageRecord).toHaveBeenCalledWith(
    expect.objectContaining({ ownerId: 1, referenceCount: 0, images: [image] })
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
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
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
  expect(screen.getAllByRole('button', { name: /View creation/ })).toHaveLength(
    2
  )
  fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
    target: { value: 'ocean-model' },
  })
  expect(screen.getAllByRole('button', { name: /View creation/ })).toHaveLength(
    1
  )
  expect(
    screen.queryByRole('button', { name: 'View creation 2' })
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
  fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
  const prompt = screen.getByRole('textbox', { name: 'Image prompt' })
  prompt.focus()
  fireEvent.compositionStart(prompt)
  fireEvent.change(prompt, { target: { value: 'hua' } })
  expect(prompt).toHaveValue('hua')
  expect(prompt).toHaveFocus()
  fireEvent.change(prompt, { target: { value: '画一只猫' } })
  fireEvent.compositionEnd(prompt, { data: '画一只猫' })
  fireEvent.change(screen.getByRole('combobox', { name: 'Resolution' }), {
    target: { value: '1K' },
  })
  fireEvent.change(screen.getByRole('combobox', { name: 'Aspect ratio' }), {
    target: { value: '3:2' },
  })
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

it('disables submission during a pending request and keeps its result after leaving and returning', async () => {
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
  await screen.findByText('Turning your idea into an image.')
  expect(
    screen.getByRole('button', { name: 'Creating your image...' })
  ).toBeDisabled()
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Image prompt' }), {
    key: 'Enter',
    ctrlKey: true,
  })
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
  await screen.findByText('Turning your idea into an image.')
  const signal = vi.mocked(generateImages).mock
    .calls[0][2] as unknown as AbortSignal
  act(() => useAuthStore.getState().auth.reset())
  expect(signal.aborted).toBe(true)
  await act(async () => finish([image]))
  expect(useImagePlaygroundStore.getState()).toMatchObject({
    records: [],
    references: [],
    parameters: { prompt: '' },
    job: null,
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
  showStudio()
  await ready()
  const prompt = screen.getByRole('textbox', { name: 'Image prompt' })
  fireEvent.change(prompt, { target: { value: 'A cat by a window' } })
  fireEvent.click(screen.getByRole('button', { name: 'Refine prompt' }))
  await waitFor(() => expect(prompt).toHaveValue('A polished studio prompt'))
  expect(refinePrompt).toHaveBeenCalledWith('A cat by a window')
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

it('expands advanced settings and prevents a transparent JPEG request', async () => {
  showStudio()
  await ready()
  expect(
    screen.queryByRole('combobox', { name: 'Image background' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'View creation 1' }))
  expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
  expect(
    screen.getByRole('button', { name: 'Continue editing' })
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Reuse settings' })).toBeDisabled()
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
  fireEvent.click(screen.getByRole('button', { name: 'View creation 1' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
    expect(
      screen.getByRole('combobox', { name: 'Aspect ratio' })
    ).toBeDisabled()
    fireEvent.change(screen.getByRole('combobox', { name: 'Resolution' }), {
      target: { value: resolution },
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Aspect ratio' }), {
      target: { value: ratio },
    })
    expect(
      screen.getByText(`Requested: ${size.replace('x', ' × ')}`)
    ).toBeInTheDocument()
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
  fireEvent.click(screen.getByRole('button', { name: 'Advanced settings' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Resolution' }), {
    target: { value: '4K' },
  })
  expect(useImagePlaygroundStore.getState().parameters.model).toBe(
    'gpt-image-2'
  )
})

it('opens reference thumbnails in the zoomable preview and preserves the uploaded file', async () => {
  showStudio()
  await ready()
  fireEvent.change(screen.getByLabelText(/Reference images/), {
    target: {
      files: [new File(['one'], 'reference.png', { type: 'image/png' })],
    },
  })
  fireEvent.click(
    screen.getByRole('button', { name: 'Preview reference reference.png' })
  )
  const dialog = await screen.findByRole('dialog')
  expect(
    within(dialog).getByRole('button', { name: 'Zoom in' })
  ).toBeInTheDocument()
  expect(within(dialog).getByRole('img')).toHaveAttribute(
    'src',
    'blob:reference'
  )
  expect(useImagePlaygroundStore.getState().references[0].file.name).toBe(
    'reference.png'
  )
})
