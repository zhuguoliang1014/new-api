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
import type {
  ChatCompletionRequest,
  Message,
  PlaygroundConfig,
  ParameterEnabled,
} from '../../types'
import { formatMessageForAPI, isValidMessage } from '../message/message-utils'

/**
 * Build API request payload from messages and config
 */
export function buildChatCompletionPayload(
  messages: Message[],
  config: PlaygroundConfig,
  parameterEnabled: ParameterEnabled
): ChatCompletionRequest {
  // Filter and format valid messages
  const validMessages = messages.filter(isValidMessage)
  const processedMessages = validMessages.map(formatMessageForAPI)

  const payload: ChatCompletionRequest = {
    model: config.model,
    group: config.group,
    messages: processedMessages,
    stream: config.stream,
  }

  const model = config.model.toLowerCase()
  const firstMessage = validMessages[0]
  if (
    firstMessage &&
    (model.startsWith('gpt-') || model.startsWith('codex-'))
  ) {
    // Keep the routing key stable across turns, edits, and retries.
    payload.prompt_cache_key = `playground-${firstMessage.key}`
  }

  const lastMessage = processedMessages.at(-1)
  if (model.startsWith('claude-') && lastMessage) {
    const content = lastMessage.content
    if (typeof content === 'string' && content.trim() !== '') {
      lastMessage.content = [
        { type: 'text', text: content, cache_control: { type: 'ephemeral' } },
      ]
    } else if (Array.isArray(content)) {
      lastMessage.content = content.map((part, index) =>
        index === content.length - 1
          ? { ...part, cache_control: { type: 'ephemeral' } }
          : part
      )
    }
  }

  if (parameterEnabled.temperature) {
    payload.temperature = config.temperature
  }

  if (parameterEnabled.top_p) {
    payload.top_p = config.top_p
  }

  if (parameterEnabled.max_tokens) {
    payload.max_tokens = config.max_tokens
  }

  if (parameterEnabled.frequency_penalty) {
    payload.frequency_penalty = config.frequency_penalty
  }

  if (parameterEnabled.presence_penalty) {
    payload.presence_penalty = config.presence_penalty
  }

  if (parameterEnabled.seed && config.seed !== null) {
    payload.seed = config.seed
  }

  return payload
}
