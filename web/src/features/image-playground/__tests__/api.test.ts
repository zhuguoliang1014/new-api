/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { beforeEach, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import {
  createStudioTask,
  getStudioGroups,
  imageRelayClient,
  listStudioTasks,
  refinePrompt,
  type StudioTask,
} from '../api'
import { defaultImageParameters } from '../types'

beforeEach(() => {
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
      accessToken: 'dashboard-access-token',
    },
  }))
})

const parameters = {
  ...defaultImageParameters,
  prompt: 'A quiet mountain lake',
  group: '【生图】超分高质量1-10k',
}

const taskID = 'studio-task-example-0001'
const metadata = { parameters, styleId: null, referenceCount: 0 }
const accepted: StudioTask = {
  id: taskID,
  status: 'queued',
  created_at: 1,
  expires_at: 36001,
  metadata,
  images: [],
  downloaded_bytes: 0,
  total_bytes: 0,
}

it('refines a prompt through the authenticated backend route', async () => {
  const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
    data: { success: true, data: { prompt: 'A cinematic mountain lake' } },
  })
  await expect(refinePrompt('  A mountain lake  ')).resolves.toBe(
    'A cinematic mountain lake'
  )
  expect(post).toHaveBeenCalledWith(
    '/api/image-playground/refine-prompt',
    { prompt: 'A mountain lake' },
    expect.objectContaining({ skipAuthRefresh: true })
  )
})

it.each([false, true])(
  'submits one durable task with group, model and idempotency ID (references: %s)',
  async (withReferences) => {
    const post = vi
      .spyOn(imageRelayClient, 'post')
      .mockResolvedValue({ data: { success: true, data: accepted } })
    const files = withReferences
      ? [
          new File(['first'], 'first.png', { type: 'image/png' }),
          new File(['second'], 'second.webp', { type: 'image/webp' }),
        ]
      : []
    const input = { ...parameters, size: '4096x2304', quality: 'high' as const }
    const result = await createStudioTask(
      taskID,
      input,
      files,
      { ...metadata, parameters: input, referenceCount: files.length },
      new AbortController().signal
    )
    expect(result.id).toBe(taskID)
    expect(post).toHaveBeenCalledOnce()
    const [path, body, config] = post.mock.calls[0]
    expect(path).toBe(
      `/api/image-playground/tasks/create/${withReferences ? 'edits' : 'generations'}`
    )
    expect(config).toMatchObject({
      skipAuthRefresh: true,
      headers: {
        'X-Studio-Task-ID': taskID,
        'X-Studio-Group': encodeURIComponent(parameters.group),
        'X-Studio-Model': parameters.model,
      },
    })
    expect(config).not.toHaveProperty('headers.Authorization')
    if (withReferences) {
      expect(body).toBeInstanceOf(FormData)
      expect((body as FormData).getAll('image[]')).toEqual(files)
      expect((body as FormData).get('size')).toBe('4096x2304')
      expect(
        JSON.parse(String((body as FormData).get('studio_metadata')))
      ).toMatchObject({ referenceCount: 2 })
    } else {
      expect(body).toMatchObject({
        size: '4096x2304',
        response_format: 'url',
        studio_metadata: { parameters: input },
      })
      expect(body).not.toHaveProperty('model')
    }
  }
)

it.each([0, -1, 5, 1.5])(
  'rejects count %s before submitting a paid task',
  async (count) => {
    const post = vi.spyOn(imageRelayClient, 'post')
    await expect(
      createStudioTask(
        taskID,
        { ...parameters, count },
        [],
        metadata,
        new AbortController().signal
      )
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  }
)

it('gives a nameless mobile reference a filename so multipart keeps it as a file', async () => {
  const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
    data: { success: true, data: accepted },
  })
  const reference = new File(['reference bytes'], '', { type: 'image/png' })
  await createStudioTask(
    taskID,
    parameters,
    [reference],
    { ...metadata, referenceCount: 1 },
    new AbortController().signal
  )
  const form = post.mock.calls[0][1] as FormData
  const uploaded = form.get('image[]') as File
  expect(uploaded.name).toBe('reference-1.png')
  expect(uploaded.type).toBe('image/png')
  const bytes = await new Promise<string>((resolve) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)), {
      once: true,
    })
    reader.readAsText(uploaded)
  })
  expect(bytes).toBe('reference bytes')
})

it.each(['unreadable', 'truncated'])(
  'rejects a %s reference before submitting a billable task',
  async (failure) => {
    const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
      data: { success: true, data: accepted },
    })
    vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(
      function (this: FileReader) {
        if (failure === 'unreadable') {
          this.dispatchEvent(new Event('error'))
        } else {
          Object.defineProperty(this, 'result', { value: new ArrayBuffer(0) })
          this.dispatchEvent(new Event('load'))
        }
      }
    )
    await expect(
      createStudioTask(
        taskID,
        parameters,
        [new File(['reference'], 'photo.png', { type: 'image/png' })],
        { ...metadata, referenceCount: 1 },
        new AbortController().signal
      )
    ).rejects.toThrow(
      'Could not read the reference image. Select it again and retry.'
    )
    expect(post).not.toHaveBeenCalled()
  }
)

it('does not submit a task when reference reading is cancelled', async () => {
  const post = vi.spyOn(imageRelayClient, 'post')
  const controller = new AbortController()
  vi.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => {
    controller.abort()
  })
  await expect(
    createStudioTask(
      taskID,
      parameters,
      [new File(['reference'], 'photo.png', { type: 'image/png' })],
      { ...metadata, referenceCount: 1 },
      controller.signal
    )
  ).rejects.toThrow('Aborted')
  expect(post).not.toHaveBeenCalled()
})

it('does not submit a task after the session has ended', async () => {
  const post = vi.spyOn(imageRelayClient, 'post')
  useAuthStore.getState().auth.reset()
  await expect(
    createStudioTask(
      taskID,
      parameters,
      [],
      metadata,
      new AbortController().signal
    )
  ).rejects.toThrow('Aborted')
  expect(post).not.toHaveBeenCalled()
})

it('rejects a malformed task response instead of treating it as a completed image', async () => {
  vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
    data: { success: true, data: { id: '../../outside', status: 'ready' } },
  })
  await expect(
    createStudioTask(
      taskID,
      parameters,
      [],
      metadata,
      new AbortController().signal
    )
  ).rejects.toThrow()
})

it('loads persisted task IDs through the authenticated query endpoint', async () => {
  const get = vi
    .spyOn(imageRelayClient, 'get')
    .mockResolvedValue({ data: { success: true, data: [accepted] } })
  const signal = new AbortController().signal
  await expect(listStudioTasks(signal)).resolves.toEqual([accepted])
  expect(get).toHaveBeenCalledWith('/api/image-playground/tasks', { signal })
})

it('submits five MJ references and explicit zero controls as JSON without GPT-only fields', async () => {
  const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
    data: { success: true, data: accepted },
  })
  const input = {
    ...parameters,
    group: '画图',
    model: 'mj-v8.2',
    size: '16:9',
    mj: { seed: 0, chaos: 0, raw: false, tile: true, stylize: 250 },
  }
  const references = Array.from(
    { length: 5 },
    (_, index) =>
      new File(['reference'], `reference-${index}.png`, { type: 'image/png' })
  )
  await createStudioTask(
    taskID,
    input,
    references,
    { ...metadata, parameters: input, referenceCount: 5 },
    new AbortController().signal
  )
  const [path, body] = post.mock.calls[0]
  expect(path).toBe('/api/image-playground/tasks/create/edits')
  expect(body).not.toBeInstanceOf(FormData)
  expect(body).toMatchObject({
    n: 1,
    size: '16:9',
    response_format: 'url',
    images: Array(5).fill('data:image/png;base64,cmVmZXJlbmNl'),
    seed: 0,
    chaos: 0,
    raw: false,
    tile: true,
    stylize: 250,
  })
  expect(body).not.toHaveProperty('quality')
  expect(body).not.toHaveProperty('output_format')
  expect(body).not.toHaveProperty('background')
})

it('accepts Banana 4K dimensions and sends no GPT-only output settings', async () => {
  const post = vi
    .spyOn(imageRelayClient, 'post')
    .mockResolvedValue({ data: { success: true, data: accepted } })
  const input = {
    ...parameters,
    group: '画图',
    model: 'gemini-3-pro-image-preview',
    size: '4096x2304',
  }
  await createStudioTask(
    taskID,
    input,
    [],
    { ...metadata, parameters: input },
    new AbortController().signal
  )
  const body = post.mock.calls[0][1]
  expect(body).toMatchObject({ size: '4096x2304', n: 1 })
  expect(body).not.toHaveProperty('quality')
  expect(body).not.toHaveProperty('output_format')
})

it('removes retired high-quality and 1K choices from a cached studio catalog', async () => {
  const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValueOnce({
    data: {
      success: true,
      data: [
        {
          id: '画图',
          models: [
            'gpt-image-2-basic',
            'gpt-image-2-hq',
            'gpt-image-2-native',
            'gemini-2.5-flash-image',
          ],
          available: true,
        },
      ],
    },
  })
  try {
    const groups = await getStudioGroups()
    expect(groups[0].models).toEqual([
      'gpt-image-2-basic',
      'gpt-image-2-native',
    ])
  } finally {
    post.mockRestore()
  }
})

it.each(['auto', 'gif'] as const)(
  'submits 2.6 %s output as base64 and accepts completed GIF tasks',
  async (format) => {
    const input = {
      ...parameters,
      model: 'gpt-image-2.6-basic',
      format,
    }
    const gifMetadata = { ...metadata, parameters: input }
    const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
      data: { success: true, data: { ...accepted, metadata: gifMetadata } },
    })
    await createStudioTask(
      taskID,
      input,
      [],
      gifMetadata,
      new AbortController().signal
    )
    expect(post.mock.calls[0][1]).toMatchObject({
      output_format: format,
      response_format: 'b64_json',
    })
    vi.spyOn(imageRelayClient, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            ...accepted,
            metadata: gifMetadata,
            status: 'ready',
            images: [
              {
                index: 0,
                width: 1024,
                height: 1024,
                bytes: 1024,
                content_type: 'image/gif',
              },
            ],
          },
        ],
      },
    })
    expect(
      (await listStudioTasks(new AbortController().signal))[0].images[0]
        .content_type
    ).toBe('image/gif')
  }
)

it('rejects GIF on unsupported routes before creating a paid task', async () => {
  const post = vi.spyOn(imageRelayClient, 'post')
  const input = {
    ...parameters,
    model: 'gpt-image-2-basic',
    format: 'gif' as const,
  }
  await expect(
    createStudioTask(
      taskID,
      input,
      [],
      { ...metadata, parameters: input },
      new AbortController().signal
    )
  ).rejects.toThrow('This model does not support the selected file format.')
  expect(post).not.toHaveBeenCalled()
})

it.each(['gpt-image-2.6-flare-basic', 'gpt-image-2.6-sunburst-native'])(
  'submits SVG and restores SVG metadata for %s',
  async (model) => {
    const input = { ...parameters, model, format: 'svg' as const }
    const meta = { ...metadata, parameters: input }
    const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
      data: { success: true, data: { ...accepted, metadata: meta } },
    })
    await createStudioTask(
      taskID,
      input,
      [],
      meta,
      new AbortController().signal
    )
    expect(post.mock.calls[0][1]).toMatchObject({
      output_format: 'svg',
      response_format: 'b64_json',
    })
    vi.spyOn(imageRelayClient, 'get').mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            ...accepted,
            status: 'ready',
            metadata: meta,
            images: [
              {
                index: 0,
                width: 640,
                height: 480,
                bytes: 4000,
                content_type: 'image/svg+xml',
              },
            ],
          },
        ],
      },
    })
    expect(
      (await listStudioTasks(new AbortController().signal))[0].images[0]
        .content_type
    ).toBe('image/svg+xml')
  }
)

it('keeps every mixed GIF and static result even when the provider exceeds requested count', async () => {
  const input = {
    ...parameters,
    model: 'gpt-image-2.6-basic',
    format: 'gif' as const,
    count: 1,
  }
  const images = Array.from({ length: 5 }, (_, index) => ({
    index,
    width: 1024,
    height: 1024,
    bytes: 1000,
    content_type: index === 0 ? 'image/gif' : 'image/png',
  }))
  vi.spyOn(imageRelayClient, 'get').mockResolvedValue({
    data: {
      success: true,
      data: [
        {
          ...accepted,
          status: 'ready',
          metadata: { ...metadata, parameters: input },
          images,
        },
      ],
    },
  })
  const tasks = await listStudioTasks(new AbortController().signal)
  expect(tasks[0].images).toHaveLength(5)
  expect(tasks[0].images.map((image) => image.content_type)).toEqual([
    'image/gif',
    'image/png',
    'image/png',
    'image/png',
    'image/png',
  ])
})
