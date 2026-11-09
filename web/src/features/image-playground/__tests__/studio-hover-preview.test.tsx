import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { Button } from '@/components/ui/button'

import { StudioImageHoverPreview } from '../components/studio-image-hover-preview'
import { compileManualPrompt, editableCreativePrompt } from '../lib/creative'
import {
  defaultFashionShoot,
  fashionShootInstruction,
} from '../lib/fashion-shoot'

it('opens a large image on mouse hover and keeps the selection button usable', async () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList)
  const user = userEvent.setup()
  render(
    <StudioImageHoverPreview
      src='/reference-original.png'
      label='Side view'
      large
      trigger={<Button>Select pose</Button>}
    />
  )
  const trigger = screen.getByRole('button', { name: 'Select pose' })
  await user.hover(trigger)
  expect(await screen.findByText('Side view')).toBeInTheDocument()
  expect(screen.getByRole('img', { name: 'Side view' })).toHaveAttribute(
    'src',
    '/reference-original.png'
  )
  expect(trigger).toBeEnabled()
  await user.unhover(trigger)
  await waitFor(() =>
    expect(screen.queryByText('Side view')).not.toBeInTheDocument()
  )
})

it('preserves spaces and English creative text while hiding known legacy system blocks', () => {
  expect(editableCreativePrompt('A quiet lake ')).toBe('A quiet lake ')
  expect(
    editableCreativePrompt(
      '湖边肖像\nCreate one coherent character image following the creative brief. More internal instructions'
    )
  ).toBe('湖边肖像')
  expect(
    editableCreativePrompt(
      'A landscape\nReference image 1: scene reference only.'
    )
  ).toBe('A landscape')
})

it('lets touch and narrow-screen users select directly without an overlapping hover layer', async () => {
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList)
  const selected = vi.fn()
  const user = userEvent.setup()
  render(
    <StudioImageHoverPreview
      src='/original.png'
      label='Pose original'
      large
      trigger={<Button onClick={selected}>Select pose</Button>}
    />
  )
  await user.click(screen.getByRole('button', { name: 'Select pose' }))
  expect(selected).toHaveBeenCalledTimes(1)
  expect(
    screen.queryByRole('img', { name: 'Pose original' })
  ).not.toBeInTheDocument()
})

it('keeps internal character instructions within the MJ prompt budget for a short brief', () => {
  const prompt = compileManualPrompt(
    'portrait',
    `A portrait beside a lake\n${fashionShootInstruction(defaultFashionShoot, false, true)}`,
    [
      {
        id: 'p',
        role: 'identity',
        file: new File(['p'], 'p.png'),
        preview: '',
      },
      { id: 'o', role: 'outfit', file: new File(['o'], 'o.png'), preview: '' },
      {
        id: 'g',
        role: 'pose',
        file: new File(['g'], 'g.png'),
        preview: '',
        assetRole: 'pose',
        assetInstruction:
          'Camera: Side view. Match the selected reference viewpoint.',
      },
    ],
    true
  )
  expect(prompt.length).toBeLessThanOrEqual(1023)
  expect(prompt).toContain('Camera: Side view.')
  expect(prompt).toContain('garments')
})
