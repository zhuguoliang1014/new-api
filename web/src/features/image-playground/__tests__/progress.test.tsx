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
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import { GenerationProgress } from '../components/generation-progress'
import { ImageArtwork } from '../components/studio-image'
import { defaultImageParameters, type ImageJob } from '../types'

it('uses received bytes for download progress without inventing a generation percentage', () => {
  const job: ImageJob = {
    id: 'studio-task-progress-001',
    startedAt: Date.now(),
    parameters: { ...defaultImageParameters, prompt: 'A lake' },
    referenceCount: 0,
    controller: new AbortController(),
    serverTask: true,
    status: 'generating',
  }
  const view = render(<GenerationProgress job={job} />)
  expect(screen.getByText('Creating...')).toBeInTheDocument()
  expect(
    screen.queryByText(
      'Safe to refresh. Images stay on the server for 10 hours.'
    )
  ).not.toBeInTheDocument()
  expect(view.container.textContent).not.toContain('%')
  expect(
    screen.queryByRole('button', { name: 'Stop waiting' })
  ).not.toBeInTheDocument()
  view.rerender(
    <GenerationProgress
      job={{
        ...job,
        status: 'downloading',
        downloadedBytes: 1048576,
        totalBytes: 4194304,
      }}
    />
  )
  expect(screen.getByText('Receiving image on server...')).toBeInTheDocument()
  expect(
    screen.getByText(/Downloaded 1.0 MB.*4.0 MB · 25%/)
  ).toBeInTheDocument()
  view.rerender(
    <GenerationProgress
      job={{
        ...job,
        status: 'downloading',
        downloadedBytes: 1048576,
        totalBytes: 0,
      }}
    />
  )
  expect(screen.getByText('Downloaded 1.0 MB')).toBeInTheDocument()
  expect(view.container.textContent).not.toContain('%')
})

it('displays original dimensions while showing a smaller thumbnail', () => {
  render(
    <ImageArtwork
      image={{
        id: 'image',
        src: '/api/image-playground/tasks/studio-task-progress-001/images/0',
        previewSrc: 'data:image/jpeg;base64,dGVzdA==',
        width: 8192,
        height: 4608,
      }}
      requestedSize='8192x4608'
    />
  )
  const image = screen.getByRole('img', { name: 'Generated image' })
  Object.defineProperty(image, 'naturalWidth', { value: 768 })
  Object.defineProperty(image, 'naturalHeight', { value: 432 })
  fireEvent.load(image)
  expect(screen.getByText('Original: 8192 × 4608')).toBeInTheDocument()
  expect(screen.queryByText(/768 × 432/)).not.toBeInTheDocument()
})

it('waits for authenticated caching when no thumbnail is available', () => {
  render(
    <ImageArtwork
      image={{
        id: 'image',
        src: '/api/image-playground/tasks/studio-task-progress-001/images/0',
      }}
    />
  )
  expect(screen.getByRole('status')).toHaveTextContent(
    'Saving images locally...'
  )
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})
