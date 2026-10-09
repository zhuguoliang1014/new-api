import { afterEach, assert, expect, it, vi } from 'vitest'

import buildConfig from '../../../rsbuild.config'

afterEach(() => {
  vi.unstubAllEnvs()
})

it('gives every release distinct entry, lazy script and stylesheet URLs', () => {
  vi.stubEnv('VITE_REACT_APP_VERSION', 'v1.0.0+first')
  const first = buildConfig({
    env: 'production',
    envMode: 'production',
    command: 'build',
  })
  vi.stubEnv('VITE_REACT_APP_VERSION', 'v1.0.0+second')
  const second = buildConfig({
    env: 'production',
    envMode: 'production',
    command: 'build',
  })

  const firstPaths = first.output?.distPath
  const secondPaths = second.output?.distPath
  assert(typeof firstPaths === 'object')
  assert(typeof secondPaths === 'object')
  for (const assetType of ['js', 'jsAsync', 'css', 'cssAsync'] as const) {
    const firstPath = firstPaths[assetType]
    const secondPath = secondPaths[assetType]
    expect(firstPath).toMatch(/^static\/releases\/v1\.0\.0_first\//)
    expect(secondPath).toMatch(/^static\/releases\/v1\.0\.0_second\//)
    expect(firstPath).not.toBe(secondPath)
  }
})

it('keeps development URLs independent of the release version', () => {
  vi.stubEnv('VITE_REACT_APP_VERSION', 'v1.0.0+first')
  const config = buildConfig({
    env: 'development',
    envMode: 'development',
    command: 'dev',
  })

  const paths = config.output?.distPath
  assert(typeof paths === 'object')
  expect(paths.root).toBe('dist')
  expect(paths.js).toBeUndefined()
})
