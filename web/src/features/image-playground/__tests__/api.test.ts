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
import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchTokenKey } from '@/features/keys/api'
import { useAuthStore } from '@/stores/auth-store'

import { generateImages, getImageModels, imageRelayClient } from '../api'
import { defaultImageParameters } from '../types'

vi.mock('@/features/keys/api', () => ({ fetchTokenKey: vi.fn() }))

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
  vi.mocked(fetchTokenKey).mockResolvedValue({
    success: true,
    data: { key: 'private-api-token' },
  })
})

const parameters = {
  ...defaultImageParameters,
  prompt: 'A quiet mountain lake',
  model: 'gpt-image-2',
}

describe('image relay contracts', () => {
  it.each([false, true])(
    'preserves a 4K portrait request without falling back to auto (editing: %s)',
    async (editing) => {
      const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
        data: { data: [{ b64_json: 'aW1hZ2U=' }] },
      })
      const files = editing
        ? [new File(['image'], 'reference.png', { type: 'image/png' })]
        : []
      await generateImages(
        7,
        { ...parameters, size: '2304x3456', quality: 'high' },
        files,
        new AbortController().signal
      )
      const body = post.mock.calls[0][1]
      if (editing) {
        expect((body as FormData).get('size')).toBe('2304x3456')
        expect((body as FormData).get('quality')).toBe('high')
      } else {
        expect(body).toMatchObject({ size: '2304x3456', quality: 'high' })
      }
    }
  )

  it('rejects a 4K request for a legacy model before spending quota', async () => {
    const post = vi.spyOn(imageRelayClient, 'post')
    await expect(
      generateImages(
        7,
        { ...parameters, model: 'gpt-image-1', size: '2304x3456' },
        [],
        new AbortController().signal
      )
    ).rejects.toThrow()
    expect(fetchTokenKey).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
  })

  it('generates through the same-origin relay with only the selected token in a header', async () => {
    const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
      data: { data: [{ b64_json: 'aW1hZ2U=', revised_prompt: 'A lake' }] },
    })
    const result = await generateImages(
      7,
      {
        ...parameters,
        count: 2,
        size: '1536x1024',
        quality: 'high',
        background: 'transparent',
      },
      [],
      new AbortController().signal
    )
    expect(fetchTokenKey).toHaveBeenCalledWith(7, expect.any(AbortSignal))
    expect(post).toHaveBeenCalledWith(
      '/images/generations',
      {
        model: 'gpt-image-2',
        prompt: parameters.prompt,
        n: 2,
        size: '1536x1024',
        quality: 'high',
        output_format: 'png',
        background: 'transparent',
      },
      expect.objectContaining({
        headers: { Authorization: 'Bearer sk-private-api-token' },
      })
    )
    expect(result[0]).toMatchObject({
      src: 'data:image/png;base64,aW1hZ2U=',
      revisedPrompt: 'A lake',
    })
  })

  it('uses multipart edit fields and preserves every uploaded file without a JSON content type', async () => {
    const post = vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
      data: { data: [{ url: 'https://images.example/one.webp' }] },
    })
    const files = [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.webp', { type: 'image/webp' }),
    ]
    await generateImages(
      7,
      { ...parameters, format: 'webp', count: 3 },
      files,
      new AbortController().signal
    )
    const [path, body, config] = post.mock.calls[0]
    expect(path).toBe('/images/edits')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).getAll('image[]')).toEqual(files)
    expect((body as FormData).get('n')).toBe('3')
    expect((body as FormData).get('quality')).toBe('auto')
    expect((body as FormData).get('output_format')).toBe('webp')
    expect(config?.headers).not.toHaveProperty('Content-Type')
  })

  it.each([0, -1, 5, 1.5, 129])(
    'rejects image count %s before revealing a credential or spending quota',
    async (count) => {
      const post = vi.spyOn(imageRelayClient, 'post')
      await expect(
        generateImages(
          7,
          { ...parameters, count },
          [],
          new AbortController().signal
        )
      ).rejects.toThrow()
      expect(fetchTokenKey).not.toHaveBeenCalled()
      expect(post).not.toHaveBeenCalled()
    }
  )

  it('omits GPT-specific fields and bounds DALL-E 3 to one image after a model change', async () => {
    const post = vi
      .spyOn(imageRelayClient, 'post')
      .mockResolvedValue({ data: { data: [{ b64_json: 'aW1hZ2U=' }] } })
    await generateImages(
      7,
      {
        ...parameters,
        model: 'dall-e-3',
        count: 4,
        size: '1792x1024',
        quality: 'hd',
        background: 'transparent',
        format: 'jpeg',
      },
      [],
      new AbortController().signal
    )
    expect(post.mock.calls[0][1]).toEqual({
      model: 'dall-e-3',
      prompt: parameters.prompt,
      n: 1,
      size: '1792x1024',
      quality: 'hd',
      response_format: 'b64_json',
    })
  })

  it('rejects unsupported file types and excess references before any request', async () => {
    await expect(
      generateImages(
        7,
        parameters,
        [new File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' })],
        new AbortController().signal
      )
    ).rejects.toThrow('PNG')
    const files = Array.from(
      { length: 5 },
      () => new File(['img'], 'a.png', { type: 'image/png' })
    )
    await expect(
      generateImages(7, parameters, files, new AbortController().signal)
    ).rejects.toThrow('4 reference')
    expect(fetchTokenKey).not.toHaveBeenCalled()
  })

  it('uses the actual base64 format when a provider ignores the requested output format', async () => {
    vi.spyOn(imageRelayClient, 'post').mockResolvedValue({
      data: { data: [{ b64_json: 'iVBORw0KGgo=' }] },
    })
    const result = await generateImages(
      7,
      { ...parameters, format: 'jpeg' },
      [],
      new AbortController().signal
    )
    expect(result[0].src).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('discovers image endpoints from token-scoped models, including an alias', async () => {
    vi.spyOn(imageRelayClient, 'get').mockResolvedValue({
      data: {
        data: [
          { id: 'gpt-image-2', supported_endpoint_types: ['image-generation'] },
          { id: 'custom-art', supported_endpoint_types: ['image-generation'] },
          { id: 'text-only', supported_endpoint_types: ['openai'] },
        ],
      },
    })
    expect(await getImageModels(7, new AbortController().signal)).toEqual([
      'gpt-image-2',
      'custom-art',
    ])
  })

  it('discards a revealed credential when the session changes before the relay starts', async () => {
    vi.mocked(fetchTokenKey).mockImplementation(async () => {
      useAuthStore.getState().auth.reset()
      return { success: true, data: { key: 'private-api-token' } }
    })
    const post = vi.spyOn(imageRelayClient, 'post')
    await expect(
      generateImages(7, parameters, [], new AbortController().signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(post).not.toHaveBeenCalled()
  })

  it('does not replay a 401 image request and redacts the credential from its reported error', async () => {
    const adapter = vi.fn(async (config) => {
      const response = {
        data: { error: { message: 'Rejected sk-private-api-token' } },
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        config,
      }
      throw new AxiosError(
        'Unauthorized',
        'ERR_BAD_REQUEST',
        config,
        undefined,
        response
      )
    })
    const previous = imageRelayClient.defaults.adapter
    imageRelayClient.defaults.adapter = adapter
    try {
      await expect(
        generateImages(7, parameters, [], new AbortController().signal)
      ).rejects.toThrow('Rejected [redacted]')
      expect(adapter).toHaveBeenCalledTimes(1)
      expect(adapter.mock.calls[0][0].headers.get('Authorization')).toBe(
        'Bearer sk-private-api-token'
      )
    } finally {
      imageRelayClient.defaults.adapter = previous
    }
  })

  it.each([
    { data: [] },
    { data: [{ url: 'javascript:alert(1)' }] },
    { error: { message: 'quota exhausted' } },
  ])(
    'rejects missing images, unsafe URLs and upstream error envelopes',
    async (response) => {
      vi.spyOn(imageRelayClient, 'post').mockResolvedValue({ data: response })
      await expect(
        generateImages(7, parameters, [], new AbortController().signal)
      ).rejects.toThrow()
    }
  )
})
