/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
*/
import { ArrowRight, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IconWeChat } from '@/assets/brand-icons'
import { CopyButton } from '@/components/copy-button'
import { SectionPageLayout } from '@/components/layout'

const QR_CODE_SRC =
  'https://aicloudroute.com/static/uploads/images/announce-wechat-qrcode.jpg'
const WECHAT_ID = 'ls587657'

export function WeChatCommunity() {
  const { t } = useTranslation()
  const [qrCodeFailed, setQrCodeFailed] = useState(false)

  return (
    <SectionPageLayout hideHeader>
      <SectionPageLayout.Content>
        <div className='relative isolate min-h-full overflow-hidden'>
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-0 -z-10'
            style={{
              background:
                'radial-gradient(circle at 11% 9%, color-mix(in oklch, #20c77a 18%, transparent), transparent 30%), radial-gradient(circle at 88% 18%, color-mix(in oklch, #60a5fa 18%, transparent), transparent 28%), radial-gradient(circle at 52% 72%, color-mix(in oklch, #fbbf24 9%, transparent), transparent 28%)',
            }}
          />
          <div
            aria-hidden='true'
            className='pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] [background-image:linear-gradient(to_right,color-mix(in_oklch,var(--foreground)_8%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklch,var(--foreground)_8%,transparent)_1px,transparent_1px)] [mask-image:linear-gradient(to_bottom,black,transparent)] [background-size:72px_72px] opacity-20'
          />

          <section className='mx-auto grid w-full max-w-5xl items-center gap-10 px-3 pt-8 pb-16 sm:px-6 sm:pt-12 lg:grid-cols-[1fr_0.9fr] lg:gap-14 lg:px-8 lg:pt-16'>
            <div className='max-w-lg'>
              <h1 className='text-foreground text-4xl leading-[1.08] font-semibold tracking-[-0.04em] sm:text-6xl'>
                {t('Contact support on WeChat')}
                <span className='mt-2 block bg-linear-to-r from-emerald-500 via-cyan-500 to-blue-500 bg-clip-text pb-1 text-transparent'>
                  {t('We are here to help.')}
                </span>
              </h1>
              <p className='text-muted-foreground mt-6 max-w-lg text-base leading-7 sm:text-lg'>
                {t(
                  'Scan the QR code or add our support account for help and community updates.'
                )}
              </p>

              <div className='mt-8 flex flex-wrap items-center gap-3'>
                <a
                  href='#wechat-qr'
                  className='group focus-visible:ring-offset-background inline-flex h-11 items-center gap-2 rounded-full bg-emerald-500 px-5 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(16,185,129,0.9)] transition duration-200 hover:-translate-y-0.5 hover:bg-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:outline-none'
                >
                  <IconWeChat className='size-4' />
                  {t('Add me on WeChat')}
                  <ArrowRight className='size-4 transition-transform group-hover:translate-x-0.5' />
                </a>
              </div>
            </div>

            <div
              id='wechat-qr'
              className='relative mx-auto w-full max-w-[430px] scroll-mt-24'
            >
              <div
                aria-hidden='true'
                className='absolute -inset-5 rounded-[2.25rem] bg-emerald-500/10 blur-3xl'
              />
              <div className='bg-card/75 border-border/70 relative overflow-hidden rounded-[2rem] border shadow-2xl shadow-emerald-950/10 backdrop-blur-xl dark:shadow-black/30'>
                <div className='flex items-center justify-between bg-emerald-500/10 px-5 py-4'>
                  <div>
                    <p className='text-foreground text-sm font-semibold'>
                      {t('Scan to connect')}
                    </p>
                    <p className='text-muted-foreground mt-1 text-xs'>
                      {t('WeChat connection')}
                    </p>
                  </div>
                  <div className='flex size-10 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'>
                    <ScanLine className='size-5' />
                  </div>
                </div>

                <div className='px-3 pt-3'>
                  <div className='bg-background border-border/60 relative flex aspect-square items-center justify-center overflow-hidden rounded-[1.4rem] border p-5'>
                    {!qrCodeFailed ? (
                      <img
                        src={QR_CODE_SRC}
                        alt={t('WeChat login QR code')}
                        className='size-full max-w-[290px] rounded-xl object-contain'
                        onError={() => setQrCodeFailed(true)}
                      />
                    ) : (
                      <div className='text-muted-foreground flex max-w-[220px] flex-col items-center text-center'>
                        <div className='relative mb-5 grid size-40 place-items-center rounded-2xl border-2 border-dashed border-emerald-500/35 bg-emerald-500/5'>
                          <div className='absolute inset-5 rounded-lg border border-emerald-500/25 [background-image:linear-gradient(45deg,transparent_45%,color-mix(in_oklch,#20c77a_20%,transparent)_46%,color-mix(in_oklch,#20c77a_20%,transparent)_54%,transparent_55%)] [background-size:12px_12px]' />
                          <IconWeChat className='relative size-12 text-emerald-500' />
                        </div>
                        <p className='text-foreground text-sm font-medium'>
                          {t('Your QR code will appear here')}
                        </p>
                        <p className='mt-2 text-xs leading-5'>
                          {t(
                            'Replace this placeholder with your WeChat QR image.'
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <div className='border-border/60 mt-3 flex items-center justify-between gap-4 border-t px-6 pt-4 pb-4'>
                  <div className='min-w-0'>
                    <p className='text-muted-foreground text-[11px] font-medium tracking-wide uppercase'>
                      {t('Customer service WeChat ID')}
                    </p>
                    <p className='text-foreground mt-1 truncate font-mono text-base font-semibold tracking-[0.08em]'>
                      {WECHAT_ID}
                    </p>
                  </div>
                  <CopyButton
                    value={WECHAT_ID}
                    size='sm'
                    variant='outline'
                    tooltip={t('Copy WeChat ID')}
                    aria-label={t('Copy WeChat ID')}
                  >
                    <span className='hidden sm:inline'>{t('Copy')}</span>
                  </CopyButton>
                </div>
              </div>
            </div>
          </section>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
