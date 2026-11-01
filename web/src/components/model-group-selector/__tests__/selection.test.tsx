import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { ModelSelector } from '../../model-group-selector'

const models = [
  {
    value: 'banana-preview',
    label: 'Banana Pro',
    category: 'Banana',
    description: 'gemini-3-pro-image-preview',
    price: '¥0.1248/image',
  },
  {
    value: 'mj-v8.2',
    label: 'Midjourney v8.2',
    category: 'Midjourney',
    description: 'mj-v8.2',
    price: '¥1.3/request',
  },
]

afterEach(() => vi.unstubAllGlobals())

it('matches the desktop field popup width to the model selector', async () => {
  const user = userEvent.setup()
  render(
    <ModelSelector
      presentation='field'
      selectedModel='banana-preview'
      models={models}
      onModelChange={vi.fn()}
    />
  )
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  const popup = screen
    .getByRole('listbox')
    .closest('[data-slot="popover-content"]')
  expect(popup).toHaveClass('w-[var(--anchor-width)]')
})

it('keeps the description and price together below the model name and supports keyboard selection', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(
    <ModelSelector
      presentation='field'
      selectedModel='banana-preview'
      models={models}
      onModelChange={onChange}
    />
  )
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  const option = screen.getByRole('option', { name: /Banana Pro/ })
  const price = within(option).getByText('¥0.1248/image')
  const description = within(option).getByText('gemini-3-pro-image-preview')
  expect(price.parentElement).toBe(description.parentElement)
  expect(price.parentElement).toHaveClass('text-muted-foreground', 'text-xs')
  expect(price).toHaveClass('shrink-0', 'whitespace-nowrap')
  expect(description).toHaveClass('truncate')
  expect(within(option).getByText('Banana Pro').parentElement).toHaveClass(
    'min-w-0',
    'break-words'
  )
  expect(description.parentElement?.previousElementSibling).toHaveTextContent(
    'Banana Pro'
  )
  await user.type(screen.getByPlaceholderText('Search models...'), 'Midjourney')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(onChange).toHaveBeenCalledWith('mj-v8.2')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveFocus()
})

it('shows prices and searchable categories in the narrow-screen drawer and clears the search on close', async () => {
  vi.stubGlobal('innerWidth', 320)
  const user = userEvent.setup()
  render(
    <ModelSelector
      presentation='field'
      selectedModel='banana-preview'
      models={models}
      onModelChange={vi.fn()}
    />
  )
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  expect(
    screen.getByRole('dialog', { name: 'Select Model' })
  ).toBeInTheDocument()
  fireEvent.change(screen.getByPlaceholderText('Search models...'), {
    target: { value: 'Midjourney' },
  })
  expect(
    within(screen.getByRole('listbox')).getAllByRole('option')
  ).toHaveLength(1)
  const price = screen.getByText('¥1.3/request')
  expect(price.parentElement).toBe(screen.getByText('mj-v8.2').parentElement)
  expect(price.parentElement?.previousElementSibling).toHaveTextContent(
    'Midjourney v8.2'
  )
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('combobox', { name: 'Model' }))
  expect(screen.getByPlaceholderText('Search models...')).toHaveValue('')
  expect(
    within(screen.getByRole('listbox')).getAllByRole('option')
  ).toHaveLength(2)
})
