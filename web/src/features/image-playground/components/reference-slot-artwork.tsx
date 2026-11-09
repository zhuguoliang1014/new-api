/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
/** Small, purpose-built illustrations for the three empty reference slots. */
export function ReferenceSlotArtwork(props: {
  role: 'identity' | 'outfit' | 'pose'
}) {
  return (
    <svg
      className={`reference-slot-artwork is-${props.role}`}
      viewBox='0 0 88 104'
      fill='none'
      aria-hidden='true'
    >
      <rect
        x='6'
        y='5'
        width='76'
        height='94'
        rx='18'
        className='reference-art-paper'
      />
      {props.role === 'identity' && (
        <g
          stroke='currentColor'
          strokeWidth='1.6'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <path
            d='M21 84c1-15 9-22 23-22s22 7 23 22'
            className='reference-art-fill'
          />
          <path
            d='M32 43c0-15 5-23 14-23 12 0 16 9 13 25l-4 13H33Z'
            className='reference-art-hair'
          />
          <path
            d='M35 35c-1 16 2 23 10 23 9 0 12-10 11-22-8 1-12-4-14-7-1 4-3 6-7 6Z'
            className='reference-art-skin'
          />
          <path d='M39 56v8m12-8v8m-16 3 10 9 10-9M39 42h1m10 0h1m-10 8c2 2 5 2 7 0' />
        </g>
      )}
      {props.role === 'outfit' && (
        <g
          stroke='currentColor'
          strokeWidth='1.6'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <path d='M41 23c0-5 7-5 7-1 0 4-4 4-4 8m0 0L22 42h44L44 30Z' />
          <path
            d='m33 40-13 8-7 22 12 4 6-15v28h29V59l5 15 12-4-8-22-14-8-11 7Z'
            className='reference-art-fill'
          />
          <path d='m34 40 10 7-7 13-6-12m23-8-10 7 7 13 7-12M44 49v38m7-18h5m-21 0h4' />
          <path d='M48 67v1m0 9v1' />
        </g>
      )}
      {props.role === 'pose' && (
        <g
          stroke='currentColor'
          strokeWidth='1.6'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <path d='M18 91h51' opacity='.25' />
          <ellipse
            cx='49'
            cy='24'
            rx='8'
            ry='10'
            className='reference-art-skin'
            transform='rotate(12 49 24)'
          />
          <path
            d='m44 34-9 10 2 19 18 2 4-19-7-12Z'
            className='reference-art-fill'
          />
          <path
            d='m36 42-12 9-9-8m43 3 7 13-6 11m-21-7-8 16 5 12m18-27-5 16 11 10'
            strokeWidth='5'
          />
          <path
            d='m36 42-12 9-9-8m43 3 7 13-6 11m-21-7-8 16 5 12m18-27-5 16 11 10'
            className='reference-art-limb'
            strokeWidth='2'
          />
          <path d='m35 91 6 1m18-2 6 1M39 50l16 3m-9-18-3 28' opacity='.45' />
          <circle cx='24' cy='51' r='2.2' className='reference-art-joint' />
          <circle cx='65' cy='59' r='2.2' className='reference-art-joint' />
          <circle cx='30' cy='79' r='2.2' className='reference-art-joint' />
          <circle cx='48' cy='80' r='2.2' className='reference-art-joint' />
        </g>
      )}
    </svg>
  )
}
