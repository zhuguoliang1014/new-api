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
import { ArrowUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { useImagePlaygroundStore } from '../store'

export function StudioInspiration() {
  const { t } = useTranslation()
  const examples = [
    {
      title: t('Product photography'),
      prompt: t(
        'A premium amber perfume bottle on a travertine pedestal, warm sunlight, soft shadows, a minimal editorial product photograph.'
      ),
      type: 'product',
    },
    {
      title: t('Travel poster'),
      prompt: t(
        'A vintage travel poster of a quiet mountain lake, layered forest silhouettes, a coral sun, textured paper, a limited teal and cream palette, no text.'
      ),
      type: 'poster',
    },
    {
      title: t('Dream architecture'),
      prompt: t(
        'A sculptural seaside house with curved white walls and a terracotta staircase, Mediterranean light, calm blue water, architectural photography.'
      ),
      type: 'architecture',
    },
  ]
  return (
    <div className='studio-inspiration'>
      <div className='studio-inspiration-heading'>
        <span className='studio-eyebrow'>{t('A little inspiration')}</span>
        <h2>{t('Make room for imagination.')}</h2>
        <p>
          {t(
            'Start with a thought, or borrow one below. Your next image begins here.'
          )}
        </p>
      </div>
      <div className='studio-example-grid'>
        {examples.map((example) => (
          <Button
            key={example.type}
            variant='ghost'
            className='studio-example'
            onClick={() => {
              useImagePlaygroundStore
                .getState()
                .setParameters({ prompt: example.prompt })
              document
                .querySelector<HTMLTextAreaElement>('#studio-prompt')
                ?.focus()
              document
                .querySelector<HTMLTextAreaElement>('#studio-prompt')
                ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
            }}
          >
            <svg
              viewBox='0 0 240 280'
              role='img'
              aria-label={example.title}
              className='studio-example-art'
            >
              {example.type === 'product' && (
                <>
                  <rect width='240' height='280' fill='#e6c2a0' />
                  <path d='M0 0H95L240 218V280H0Z' fill='#f3ddc0' />
                  <ellipse cx='127' cy='231' rx='85' ry='12' fill='#b99372' />
                  <path d='M46 190L155 175L202 193L93 210Z' fill='#e7d0ac' />
                  <path d='M46 190L93 210V259L46 237Z' fill='#c7b18c' />
                  <path d='M93 210L202 193V242L93 259Z' fill='#ded1b6' />
                  <rect
                    x='85'
                    y='85'
                    width='66'
                    height='110'
                    rx='10'
                    fill='#97512c'
                  />
                  <rect
                    x='91'
                    y='91'
                    width='54'
                    height='95'
                    rx='7'
                    fill='#b16b39'
                  />
                  <rect
                    x='102'
                    y='69'
                    width='32'
                    height='26'
                    rx='3'
                    fill='#3c3a2d'
                  />
                  <rect x='97' y='128' width='42' height='36' fill='#efe6d2' />
                  <path
                    d='M106 140H130M110 148H126'
                    stroke='#776552'
                    strokeWidth='2'
                  />
                </>
              )}
              {example.type === 'poster' && (
                <>
                  <rect width='240' height='280' fill='#e8e1cd' />
                  <circle cx='159' cy='83' r='37' fill='#cf7860' />
                  <path
                    d='M0 156L58 65L121 161L170 114L240 175V280H0Z'
                    fill='#668d81'
                  />
                  <path
                    d='M0 194L70 143L128 185L183 163L240 189V280H0Z'
                    fill='#2f665a'
                  />
                  <path d='M0 210Q120 167 240 222V280H0Z' fill='#c5d7c7' />
                  <path
                    d='M0 243L33 171L64 249L98 175L135 265L186 201L215 272H0Z'
                    fill='#173f38'
                  />
                  <path
                    d='M136 220H208M110 235H190M154 251H227'
                    stroke='#f5eee1'
                    strokeWidth='2'
                  />
                </>
              )}
              {example.type === 'architecture' && (
                <>
                  <rect width='240' height='280' fill='#a7c9cb' />
                  <rect y='181' width='240' height='99' fill='#6babae' />
                  <path d='M26 197V97Q26 34 89 34H159V197Z' fill='#f3eee2' />
                  <path d='M90 197V109Q90 68 136 68H187V197Z' fill='#d9d5c8' />
                  <path
                    d='M104 180V116Q104 83 141 83H171V180Z'
                    fill='#2c6060'
                  />
                  <path
                    d='M161 198V173H145V157H129V140H111V125H95V141H111V158H129V174H145V198Z'
                    fill='#bb7358'
                  />
                  <path d='M0 225L89 189L240 227V280H0Z' fill='#e4c6a6' />
                  <path
                    d='M4 244H100M175 254H240'
                    stroke='#f5e5cb'
                    strokeWidth='2'
                  />
                </>
              )}
            </svg>
            <span className='studio-example-caption'>
              {example.title}
              <ArrowUpRight size={16} aria-hidden='true' />
            </span>
          </Button>
        ))}
      </div>
      <p className='studio-example-note'>
        {t('Illustrated prompt ideas · Select one to try')}
      </p>
    </div>
  )
}
