import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'

import { OfficialCommunity } from '../components/official-community'

const originalAnimations = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'getAnimations'
)

beforeEach(async () => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
  await i18next.changeLanguage('en')
})

afterEach(async () => {
  if (originalAnimations) {
    Object.defineProperty(
      Element.prototype,
      'getAnimations',
      originalAnimations
    )
  } else {
    Reflect.deleteProperty(Element.prototype, 'getAnimations')
  }
  vi.restoreAllMocks()
  await i18next.changeLanguage('en')
})

it('opens a centered community dialog from the keyboard with the official Telegram link', async () => {
  const user = userEvent.setup()
  render(<OfficialCommunity />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  screen.getByRole('button', { name: 'Official Community' }).focus()
  await user.keyboard('{Enter}')

  const dialog = await screen.findByRole('dialog', {
    name: 'Join the official community',
  })
  expect(dialog).toHaveAccessibleDescription(
    'Message our Telegram bot and send your order number to get a community invitation.'
  )
  expect(dialog).toContainElement(document.activeElement as HTMLElement)
  expect(dialog).toHaveClass('left-1/2', '-translate-x-1/2', '-translate-y-1/2')
  expect(dialog).toHaveClass('max-w-[calc(100%-2rem)]', 'sm:max-w-[480px]')
  expect(
    within(dialog).getByRole('link', { name: 'Open Telegram' })
  ).toHaveAttribute('href', 'https://t.me/aiproxy92_bot')
  expect(within(dialog).getByRole('link')).toHaveAttribute('target', '_blank')
  expect(within(dialog).getByRole('link')).toHaveAttribute(
    'rel',
    'noopener noreferrer'
  )
})

it('closes on Escape and returns keyboard focus to the community trigger', async () => {
  const user = userEvent.setup()
  render(<OfficialCommunity />)
  const trigger = screen.getByRole('button', { name: 'Official Community' })
  await user.click(trigger)
  expect(await screen.findByRole('dialog')).toBeInTheDocument()

  await user.keyboard('{Escape}')

  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  )
  await waitFor(() => expect(trigger).toHaveFocus())
})

it('copies the bot username with a success toast without leaving the dialog', async () => {
  const user = userEvent.setup()
  const writeText = vi.spyOn(navigator.clipboard, 'writeText')
  const success = vi.spyOn(toast, 'success')
  render(<OfficialCommunity />)
  await user.click(screen.getByRole('button', { name: 'Official Community' }))

  const dialog = await screen.findByRole('dialog')
  await user.click(
    within(dialog).getByRole('button', { name: 'Copy to clipboard' })
  )

  expect(writeText).toHaveBeenCalledWith('@aiproxy92_bot')
  expect(success).toHaveBeenCalledWith('Copied to clipboard')
  expect(dialog).toBeInTheDocument()
})

it('updates the open dialog and its Telegram action when the language switches to Chinese', async () => {
  const user = userEvent.setup()
  i18next.addResourceBundle('zh', 'translation', zh.translation)
  render(<OfficialCommunity />)
  await user.click(screen.getByRole('button', { name: 'Official Community' }))
  await screen.findByRole('dialog')

  await act(async () => {
    await i18next.changeLanguage('zh')
  })

  const dialog = screen.getByRole('dialog', { name: '加入官方社群' })
  expect(
    within(dialog).getByRole('link', { name: '打开 Telegram' })
  ).toHaveAttribute('href', 'https://t.me/aiproxy92_bot')
})
