import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { Main } from '@/components/layout'
import { ImagePlayground } from '@/features/image-playground'

export const Route = createFileRoute('/_authenticated/image-playground/')({
  component: ImagePlaygroundPage,
})

function ImagePlaygroundPage() {
  const { t } = useTranslation()
  return (
    <Main
      className='studio-page-scroll overflow-y-auto p-0'
      aria-label={t('Creative studio')}
    >
      <ImagePlayground />
    </Main>
  )
}
