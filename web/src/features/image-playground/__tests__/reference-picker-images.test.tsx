import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { FashionReferencePicker } from '../components/fashion-reference-picker'
import type { PortraitAsset } from '../lib/portrait-elements'

it('browses thumbnails while preserving the clear hover preview and selected original', async () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList)
  const user = userEvent.setup()
  const asset: PortraitAsset = {
    id: 'portrait-test',
    name: 'Portrait test',
    role: 'identity',
    src: '/original.png',
    instruction: '',
    views: [
      {
        id: 'front',
        src: '/original.png',
        preview: '/clear-preview.webp',
        thumbnail: '/small-thumbnail.webp',
        instruction: '',
      },
    ],
  }
  const choose = vi.fn().mockResolvedValue(true)
  const close = vi.fn()
  const catalog = {
    data: [asset],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  } as unknown as Parameters<typeof FashionReferencePicker>[0]['catalog']
  render(
    <FashionReferencePicker
      role='identity'
      onRoleChange={vi.fn()}
      onClose={close}
      catalog={catalog}
      elements={{
        choose,
        randomize: vi.fn(),
        upload: vi.fn(),
        remove: vi.fn(),
        loading: undefined,
        error: undefined,
      }}
    />
  )
  const card = screen.getByRole('button', { name: 'Select Portrait test' })
  expect(within(card).getByRole('img')).toHaveAttribute(
    'src',
    '/small-thumbnail.webp'
  )
  await user.hover(card)
  expect(
    await screen.findByText('Portrait test', { selector: 'figcaption' })
  ).toBeInTheDocument()
  expect(
    screen
      .getAllByRole('img')
      .some((img) => img.getAttribute('src') === '/clear-preview.webp')
  ).toBe(true)
  await user.click(card)
  expect(choose).toHaveBeenCalledWith(asset, 'front')
  expect(close).toHaveBeenCalledOnce()
})
