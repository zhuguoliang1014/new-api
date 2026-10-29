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
import { describe, expect, test } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_PARAMETER_ENABLED } from '../../constants'
import { createUserMessage } from '../message/message-utils'
import { buildChatCompletionPayload } from './payload-builder'

describe('playground prompt caching', () => {
  test.each(['gpt-6.1-sol', 'codex-auto-review'])(
    '%s keeps its cache key across turns and retries',
    (model) => {
      const first = createUserMessage('First question')
      const config = { ...DEFAULT_CONFIG, model }
      const firstPayload = buildChatCompletionPayload(
        [first],
        config,
        DEFAULT_PARAMETER_ENABLED
      )
      const nextPayload = buildChatCompletionPayload(
        [first, createUserMessage('Follow-up')],
        config,
        DEFAULT_PARAMETER_ENABLED
      )
      const retry = buildChatCompletionPayload(
        [first],
        config,
        DEFAULT_PARAMETER_ENABLED
      )
      const newConversation = buildChatCompletionPayload(
        [createUserMessage('First question')],
        config,
        DEFAULT_PARAMETER_ENABLED
      )

      expect(firstPayload.prompt_cache_key).toBe(`playground-${first.key}`)
      expect(nextPayload.prompt_cache_key).toBe(firstPayload.prompt_cache_key)
      expect(retry.prompt_cache_key).toBe(firstPayload.prompt_cache_key)
      expect(newConversation.prompt_cache_key).not.toBe(
        firstPayload.prompt_cache_key
      )
      expect(firstPayload.messages[0].content).toBe('First question')
    }
  )

  test('Claude marks only the latest message and keeps stored text unchanged', () => {
    const messages = [
      createUserMessage('Stable prefix'),
      createUserMessage('Latest question'),
    ]
    const payload = buildChatCompletionPayload(
      messages,
      { ...DEFAULT_CONFIG, model: 'claude-opus-5-5' },
      DEFAULT_PARAMETER_ENABLED
    )

    expect(payload.messages).toEqual([
      { role: 'user', content: 'Stable prefix' },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Latest question',
            cache_control: { type: 'ephemeral' },
          },
        ],
      },
    ])
    expect(payload.prompt_cache_key).toBeUndefined()
    expect(messages[1].versions[0].content).toBe('Latest question')
  })

  test('other providers and empty conversations receive no cache extensions', () => {
    const payload = buildChatCompletionPayload(
      [createUserMessage('Hello')],
      { ...DEFAULT_CONFIG, model: 'deepseek-v4.1-flash' },
      DEFAULT_PARAMETER_ENABLED
    )
    expect(payload.prompt_cache_key).toBeUndefined()
    expect(payload.messages).toEqual([{ role: 'user', content: 'Hello' }])
    expect(
      buildChatCompletionPayload(
        [],
        { ...DEFAULT_CONFIG, model: 'gpt-6.1-sol' },
        DEFAULT_PARAMETER_ENABLED
      ).prompt_cache_key
    ).toBeUndefined()
    expect(
      buildChatCompletionPayload(
        [],
        { ...DEFAULT_CONFIG, model: 'claude-opus-5-5' },
        DEFAULT_PARAMETER_ENABLED
      ).messages
    ).toEqual([])
  })
})
