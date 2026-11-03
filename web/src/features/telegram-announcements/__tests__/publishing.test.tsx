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
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { TelegramAnnouncements } from '..'
import type { AnnouncementConfig } from '../types'

const config: AnnouncementConfig = {
  connected: true,
  channel_configured: true,
  bot_username: 'aiproxy92_bot',
  template: {
    footer: 'AiProxy · AI 模型 API 服务',
    channel_label: '频道地址',
    channel_url: 'https://t.me/+NrE5joFDk_MzZTRh',
    contact_label: '对接地址',
    contact_url: 'https://92ai.asia/',
  },
}
const clients: QueryClient[] = []
function renderPage(connected = true, channelConfigured = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  })
  client.setQueryData(['telegram-announcements', 'config'], {
    ...config,
    connected,
    channel_configured: channelConfigured,
  })
  clients.push(client)
  return render(
    <QueryClientProvider client={client}>
      <TelegramAnnouncements />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.includes('/config')) {
      return { data: { success: true, data: config } }
    }
    return {
      data: {
        success: true,
        data: { items: [], total: 0, page: 1, page_size: 20 },
      },
    }
  })
})
afterEach(() => {
  clients.forEach((client) => client.clear())
  clients.length = 0
  vi.restoreAllMocks()
})

describe('Telegram announcement publishing', () => {
  test('a disconnected bot disables publishing and shows setup guidance', () => {
    renderPage(false)
    expect(
      screen.getByRole('button', { name: 'Preview and publish' })
    ).toBeDisabled()
    expect(
      screen.getByText(
        'The announcement bot is not connected. Configure its protected server file first.'
      )
    ).toBeVisible()
  })

  test('empty required fields show validation without requesting a preview', async () => {
    const user = userEvent.setup()
    const post = vi.spyOn(api, 'post')
    renderPage()
    await user.click(
      screen.getByRole('button', { name: 'Preview and publish' })
    )
    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(screen.getByLabelText('Announcement title')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
    expect(post).not.toHaveBeenCalled()
  })

  test('channel publishing starts unchecked and cannot be selected before configuration', async () => {
    renderPage(true, false)
    const channel = screen.getByRole('checkbox', {
      name: 'Also publish to channel',
    })
    expect(channel).not.toBeChecked()
    expect(channel).toHaveAttribute('aria-disabled', 'true')
    expect(
      screen.getByText(
        'Configure the announcement channel before enabling this option.'
      )
    ).toBeVisible()
  })

  test('selecting the channel updates confirmation and sends the selected destination', async () => {
    const user = userEvent.setup()
    const posts = vi
      .spyOn(api, 'post')
      .mockImplementation(async (url, data) => {
        if (url.endsWith('/preview')) {
          return {
            data: {
              success: true,
              data: {
                ...(data as object),
                template: config.template,
                characters: 140,
                hash: 'channel-preview-hash',
                bot_username: config.bot_username,
                chat_id: -100123,
                channel_chat_id: -100456,
                channel_title: 'AiProxy announcements',
              },
            },
          }
        }
        return {
          data: {
            success: true,
            data: {
              id: 'receipt',
              status: 'sent',
              channel_requested: true,
              channel_status: 'sent',
              pin_requested: false,
              pin_status: 'not_requested',
            },
          },
        }
      })
    renderPage()
    const channel = screen.getByRole('checkbox', {
      name: 'Also publish to channel',
    })
    expect(channel).not.toBeChecked()
    await user.type(
      screen.getByLabelText('Announcement title'),
      'Channel update'
    )
    await user.type(
      screen.getByLabelText('Announcement content'),
      'Shared announcement'
    )
    await user.click(channel)
    expect(channel).toBeChecked()
    await user.click(
      screen.getByRole('button', { name: 'Preview and publish' })
    )
    const confirmation = await screen.findByRole('alertdialog')
    expect(
      within(confirmation).getByText(
        'This announcement will be sent to both the group and the channel.'
      )
    ).toBeVisible()
    expect(
      within(confirmation).getByText('Channel: AiProxy announcements')
    ).toBeVisible()
    await user.click(
      within(confirmation).getByRole('button', { name: 'Publish announcement' })
    )
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(
      posts.mock.calls.find(([url]) => url.endsWith('/publish'))?.[1]
    ).toMatchObject({
      publish_to_channel: true,
      preview_hash: 'channel-preview-hash',
    })
    expect(channel).not.toBeChecked()
  })

  test('channel failure preserves the draft instead of claiming a successful publication', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'post').mockImplementation(async (url, data) => {
      if (url.endsWith('/preview')) {
        return {
          data: {
            success: true,
            data: {
              ...(data as object),
              template: config.template,
              characters: 140,
              hash: 'channel-preview-hash',
              bot_username: config.bot_username,
              channel_title: 'AiProxy announcements',
            },
          },
        }
      }
      return {
        data: {
          success: true,
          data: {
            status: 'sent',
            channel_requested: true,
            channel_status: 'failed',
          },
        },
      }
    })
    renderPage()
    await user.type(
      screen.getByLabelText('Announcement title'),
      'Channel update'
    )
    await user.type(
      screen.getByLabelText('Announcement content'),
      'Keep the draft'
    )
    await user.click(
      screen.getByRole('checkbox', { name: 'Also publish to channel' })
    )
    await user.click(
      screen.getByRole('button', { name: 'Preview and publish' })
    )
    const confirmation = await screen.findByRole('alertdialog')
    await user.click(
      within(confirmation).getByRole('button', { name: 'Publish announcement' })
    )
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(screen.getByLabelText('Announcement title')).toHaveValue(
      'Channel update'
    )
  })

  test('publication requires preview confirmation and includes the chosen pin setting', async () => {
    const user = userEvent.setup()
    const posts = vi
      .spyOn(api, 'post')
      .mockImplementation(async (url, data) => {
        if (url.endsWith('/preview')) {
          return {
            data: {
              success: true,
              data: {
                ...(data as object),
                template: config.template,
                characters: 140,
                hash: 'preview-hash',
                bot_username: config.bot_username,
                chat_id: -100123,
              },
            },
          }
        }
        return {
          data: {
            success: true,
            data: {
              id: 'receipt',
              status: 'sent',
              pin_requested: true,
              pin_status: 'pinned',
            },
          },
        }
      })
    renderPage()
    await user.type(screen.getByLabelText('Announcement title'), 'WSS update')
    await user.type(
      screen.getByLabelText('Announcement content'),
      'Continuous conversations are available.'
    )
    await user.click(
      screen.getByRole('switch', { name: 'Pin in group after publishing' })
    )
    expect(screen.getByRole('switch')).toBeChecked()
    await user.click(
      screen.getByRole('button', { name: 'Preview and publish' })
    )
    const confirmation = await screen.findByRole('alertdialog')
    expect(
      posts.mock.calls.filter(([url]) => url.endsWith('/publish'))
    ).toHaveLength(0)
    expect(
      within(confirmation).getAllByRole('link', { name: '频道地址' })[0]
    ).toHaveAttribute('href', config.template.channel_url)
    expect(
      within(confirmation).getByRole('link', { name: '对接地址' })
    ).toHaveAttribute('href', config.template.contact_url)
    await user.click(
      within(confirmation).getByRole('button', { name: 'Publish announcement' })
    )
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(
      posts.mock.calls.find(([url]) => url.endsWith('/publish'))?.[1]
    ).toMatchObject({
      title: 'WSS update',
      pin: true,
      publish_to_channel: false,
      preview_hash: 'preview-hash',
    })
    expect(screen.getByLabelText('Announcement title')).toHaveValue('')
  })

  test('a failed network response keeps the publication ID for a manual retry', async () => {
    const user = userEvent.setup()
    const posts = vi
      .spyOn(api, 'post')
      .mockImplementation(async (url, data) => {
        if (url.endsWith('/preview')) {
          return {
            data: {
              success: true,
              data: {
                ...(data as object),
                template: config.template,
                characters: 120,
                hash: 'preview-hash',
                bot_username: config.bot_username,
              },
            },
          }
        }
        throw new Error('Network unavailable')
      })
    renderPage()
    await user.type(screen.getByLabelText('Announcement title'), 'Update')
    await user.type(
      screen.getByLabelText('Announcement content'),
      'Announcement body'
    )
    await user.click(
      screen.getByRole('button', { name: 'Preview and publish' })
    )
    const confirmation = await screen.findByRole('alertdialog')
    const publish = within(confirmation).getByRole('button', {
      name: 'Publish announcement',
    })
    await user.click(publish)
    await waitFor(() => expect(publish).toBeEnabled())
    expect(
      posts.mock.calls.filter(([url]) => url.endsWith('/publish'))
    ).toHaveLength(1)
    await user.click(publish)
    await waitFor(() =>
      expect(
        posts.mock.calls.filter(([url]) => url.endsWith('/publish'))
      ).toHaveLength(2)
    )
    const requests = posts.mock.calls.filter(([url]) =>
      url.endsWith('/publish')
    )
    expect(requests[0][1]).toEqual(requests[1][1])
  })

  test('switching to history and back preserves the announcement being edited', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.type(screen.getByLabelText('Announcement title'), 'Draft update')
    await user.type(
      screen.getByLabelText('Announcement content'),
      'Keep this draft'
    )
    await user.click(screen.getByRole('tab', { name: 'Publication history' }))
    await screen.findByText('No announcements published yet')
    await user.click(screen.getByRole('tab', { name: 'Write announcement' }))
    expect(screen.getByLabelText('Announcement title')).toHaveValue(
      'Draft update'
    )
    expect(screen.getByLabelText('Announcement content')).toHaveValue(
      'Keep this draft'
    )
  })

  test('editing the footer updates preview and saving applies the template to the composer', async () => {
    const user = userEvent.setup()
    const put = vi.spyOn(api, 'put').mockImplementation(async (_url, data) => ({
      data: { success: true, data },
    }))
    renderPage()
    await user.click(screen.getByRole('tab', { name: 'Announcement template' }))
    const footer = await screen.findByLabelText('Announcement footer')
    await user.clear(footer)
    await user.type(footer, 'AiProxy updates')
    expect(
      within(
        screen.getByRole('tabpanel', { name: 'Announcement template' })
      ).getByText('AiProxy updates')
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    await waitFor(() => expect(put).toHaveBeenCalled())
    await user.click(screen.getByRole('tab', { name: 'Write announcement' }))
    expect(
      await within(
        screen.getByRole('tabpanel', { name: 'Write announcement' })
      ).findByText('AiProxy updates')
    ).toBeVisible()
  })

  test('unsafe template links remain inactive in the preview and cannot be saved', async () => {
    const user = userEvent.setup()
    const put = vi.spyOn(api, 'put')
    renderPage()
    await user.click(screen.getByRole('tab', { name: 'Announcement template' }))
    const link = await screen.findByLabelText('Integration address')
    await user.clear(link)
    await user.type(link, 'javascript:alert(1)')
    expect(
      screen.queryByRole('link', { name: '对接地址' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    expect(put).not.toHaveBeenCalled()
  })

  test('history shows independent group and channel results and links', async () => {
    const user = userEvent.setup()
    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url.includes('/config')) {
        return { data: { success: true, data: config } }
      }
      return {
        data: {
          success: true,
          data: {
            items: [
              {
                id: 'receipt',
                title: 'Shared update',
                body: 'Announcement body',
                status: 'sent',
                message_url: 'https://t.me/c/123/42',
                channel_requested: true,
                channel_title: 'AiProxy announcements',
                channel_status: 'unknown',
                channel_message_url: '',
                channel_error:
                  'Channel delivery is unconfirmed. Check the channel before publishing again.',
                created_at: 1793635200,
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
          },
        },
      }
    })
    renderPage()
    await user.click(screen.getByRole('tab', { name: 'Publication history' }))
    expect(await screen.findByText('Shared update')).toBeVisible()
    expect(screen.getByText('Published')).toBeVisible()
    expect(screen.getByText('Delivery unconfirmed')).toBeVisible()
    expect(
      screen.getAllByRole('link', { name: 'Group message' })[0]
    ).toHaveAttribute('href', 'https://t.me/c/123/42')
    expect(
      screen.queryByRole('link', { name: 'Channel message' })
    ).not.toBeInTheDocument()
  })

  test('empty history shows guidance and supports refreshing', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('tab', { name: 'Publication history' }))
    expect(
      await screen.findByText('No announcements published yet')
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled()
    )
  })
})
