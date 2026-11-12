import { ChevronRight, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  sideDrawerContentClassName,
  sideDrawerFormClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

const MySubscriptionsCard = lazy(() =>
  import('./my-subscriptions-card').then((module) => ({
    default: module.MySubscriptionsCard,
  }))
)

export function MySubscriptionsSheet(props: {
  activeCount: number
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) props.onClose()
      }}
    >
      <SheetTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            className='h-auto min-h-9 whitespace-normal'
          />
        }
      >
        {t('My Subscriptions')}
        {props.activeCount > 0 && (
          <span className='text-muted-foreground text-xs'>
            {t('{{activeCount}} active', {
              activeCount: formatNumber(props.activeCount, locale),
            })}
          </span>
        )}
        <ChevronRight className='size-4 shrink-0' aria-hidden='true' />
      </SheetTrigger>
      <SheetContent
        className={sideDrawerContentClassName('sm:max-w-2xl')}
        showCloseButton={false}
      >
        <SheetHeader
          className={sideDrawerHeaderClassName(
            'flex-row items-center justify-between gap-3'
          )}
        >
          <SheetTitle>{t('My Subscriptions')}</SheetTitle>
          <SheetClose
            render={
              <Button variant='ghost' size='icon' aria-label={t('Close')} />
            }
          >
            <X className='size-4' aria-hidden='true' />
          </SheetClose>
        </SheetHeader>
        <div className={sideDrawerFormClassName()}>
          {open && (
            <Suspense fallback={<LoadingState />}>
              <MySubscriptionsCard embedded />
            </Suspense>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
