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
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '@/stores/auth-store'

import { generateImages, imageRelayClient, refinePrompt } from '../api'
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
}

describe('agent image playground contracts', () => {
  it('refines a plain-language prompt through the authenticated backend route', async () => {
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

  it('posts generation options without an API key or model selector', async () => {
    const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
      data: { data: [{ b64_json: 'aW1hZ2U=', revised_prompt: 'A lake' }] },
    })

    const result = await generateImages(
      { ...parameters, count: 2, size: '1536x1024', quality: 'high' },
      [],
      new AbortController().signal
    )
    expect(post).toHaveBeenCalledWith(
      '/pg/images/generations',
      {
        prompt: parameters.prompt,
        n: 2,
        size: '1536x1024',
        quality: 'high',
        output_format: 'png',
      },
      expect.objectContaining({ skipAuthRefresh: true })
    )
    expect(post.mock.calls[0][2]).not.toHaveProperty('headers.Authorization')
    expect(post.mock.calls[0][1]).not.toHaveProperty('model')
    expect(result[0]).toMatchObject({
      src: 'data:image/png;base64,aW1hZ2U=',
      revisedPrompt: 'A lake',
    })
  })

  it('uses the session edit route and preserves every uploaded reference', async () => {
    const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
      data: { data: [{ url: 'https://images.example/one.webp' }] },
    })
    const files = [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.webp', { type: 'image/webp' }),
    ]

    await generateImages(
      { ...parameters, format: 'webp', count: 3 },
      files,
      new AbortController().signal
    )
    const [path, body, config] = post.mock.calls[0]
    expect(path).toBe('/pg/images/edits')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).getAll('image[]')).toEqual(files)
    expect((body as FormData).get('n')).toBe('3')
    expect((body as FormData).get('output_format')).toBe('webp')
    expect(config).toMatchObject({ skipAuthRefresh: true })
  })

  it.each([0, -1, 5, 1.5])(
    'rejects image count %s before sending a request',
    async (count) => {
      const post = vi.spyOn(imageRelayClient, 'post')
      await expect(
        generateImages(
          { ...parameters, count },
          [],
          new AbortController().signal
        )
      ).rejects.toThrow()
      expect(post).not.toHaveBeenCalled()
    }
  )

  it('rejects missing or unsafe image responses', async () => {
    vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
      data: { data: [{ url: 'javascript:alert(1)' }] },
    })
    await expect(
      generateImages(parameters, [], new AbortController().signal)
    ).rejects.toThrow('usable images')
  })
})

it.each([false, true])(
  'pins the requested group and model for a concurrent request (references: %s)',
  async (withReferences) => {
    const post = vi
      .spyOn(imageRelayClient, 'post')
      .mockResolvedValue({ data: { data: [{ b64_json: 'aW1hZ2U=' }] } })
    const group = '【生图】超分高质量1-10k'
    await generateImages(
      {
        ...parameters,
        group,
        model: 'gpt-image-2.5',
        size: '3840x2160',
        quality: 'high',
      },
      withReferences
        ? [new File(['image'], 'ref.png', { type: 'image/png' })]
        : [],
      new AbortController().signal
    )
    expect(post).toHaveBeenCalledOnce()
    const [, body, config] = post.mock.calls[0]
    expect(config).toMatchObject({
      skipAuthRefresh: true,
      headers: {
        'X-Studio-Group': encodeURIComponent(group),
        'X-Studio-Model': 'gpt-image-2.5',
      },
    })
    expect(
      body instanceof FormData
        ? body.get('size')
        : (body as { size: string }).size
    ).toBe('3840x2160')
    expect(config).not.toHaveProperty('headers.Authorization')
  }
)

it.each(['4096x4096', '4096x2304', '6144x3456', '8192x4608', '10240x5760'])(
  'rejects unsupported %s before a billable request',
  async (size) => {
    const post = vi.spyOn(imageRelayClient, 'post')
    await expect(
      generateImages(
        { ...parameters, model: 'gpt-image-2.5', size },
        [],
        new AbortController().signal
      )
    ).rejects.toThrow('This model does not support the selected image size.')
    expect(post).not.toHaveBeenCalled()
  }
)
