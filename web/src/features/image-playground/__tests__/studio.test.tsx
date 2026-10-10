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

import { getApiKeys } from '@/features/keys/api'
import { useAuthStore } from '@/stores/auth-store'

import { generateImages, getImageModels } from '../api'
import { ImagePlayground } from '../index'
import { readImageHistory, saveImageRecord } from '../lib/history'
import * as imageFiles from '../lib/images'
import { useImagePlaygroundStore } from '../store'

vi.mock('@/features/keys/api', () => ({ getApiKeys: vi.fn() }))
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  generateImages: vi.fn(),
  getImageModels: vi.fn(),
}))
vi.mock('../lib/history', () => ({
  readImageHistory: vi.fn(),
  saveImageRecord: vi.fn(),
  deleteImageRecord: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: (props: { to: string; children: React.ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
}))

const key = {
  id: 7,
  name: 'Studio key',
  key: 'masked',
  status: 1,
  unlimited_quota: true,
  remain_quota: 1,
  used_quota: 0,
  expired_time: -1,
  created_time: 0,
  accessed_time: 0,
  group: 'default',
  auto_groups: null,
  cross_group_retry: false,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
}
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
  vi.mocked(getApiKeys).mockResolvedValue({
    success: true,
    data: { items: [key], total: 1, page: 1, page_size: 100 },
  })
  vi.mocked(getImageModels).mockResolvedValue(['gpt-image-2'])
  vi.mocked(readImageHistory).mockResolvedValue([])
  vi.mocked(saveImageRecord).mockResolvedValue()
  vi.mocked(generateImages).mockResolvedValue([image])
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
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Image model' })).toHaveValue(
      'gpt-image-2'
    )
  )
}

it('requires a prompt, fills an inspiration idea, and generates an actionable creation', async () => {
  showStudio()
  await ready()
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
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
      7,
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
  const signal = vi.mocked(generateImages).mock.calls[0][3]
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

it('offers manual model entry if discovery fails and excludes expired or disabled keys', async () => {
  vi.mocked(getImageModels).mockRejectedValue(new Error('models unavailable'))
  vi.mocked(getApiKeys).mockResolvedValue({
    success: true,
    data: {
      items: [
        { ...key, id: 1, name: 'expired', expired_time: 1 },
        { ...key, id: 2, name: 'disabled', status: 2 },
        key,
      ],
      total: 3,
      page: 1,
      page_size: 100,
    },
  })
  showStudio()
  await screen.findByText('Model discovery failed. You can enter a model name.')
  expect(
    screen.queryByRole('option', { name: 'expired' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('option', { name: 'disabled' })
  ).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Image model' }), {
    target: { value: 'custom-art' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Image prompt' }), {
    target: { value: 'A painting' },
  })
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
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

it('offers key creation and disables generation when no usable key exists', async () => {
  vi.mocked(getApiKeys).mockResolvedValue({
    success: true,
    data: { items: [], total: 0, page: 1, page_size: 100 },
  })
  showStudio()
  expect(
    await screen.findByRole('link', { name: 'Create API Key' })
  ).toHaveAttribute('href', '/keys')
  expect(screen.getByRole('button', { name: 'Generate image' })).toBeDisabled()
  expect(getImageModels).not.toHaveBeenCalled()
})

it('stops a request without retrying and restores submission with a charge-status explanation', async () => {
  vi.mocked(generateImages).mockImplementation(
    (_key, _parameters, _references, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        )
      })
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

it('expands output settings and prevents a transparent JPEG request', async () => {
  showStudio()
  await ready()
  expect(
    screen.queryByRole('combobox', { name: 'Image background' })
  ).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Output settings' }))
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
})
