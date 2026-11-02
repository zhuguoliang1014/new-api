import { readFileSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import { gzipSync } from 'node:zlib'

// Match the gzip level used by the gateway. Count every blocking entry asset,
// including shared chunks, so moving code out of index.js cannot hide growth.
const root = resolve(process.argv[2] ?? 'dist')
const html = readFileSync(resolve(root, 'index.html'), 'utf8')
const assets = new Set(
  [
    ...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g),
  ].map((match) => match[1].split('?')[0])
)
if (assets.size === 0) {
  throw new Error('No startup JS/CSS assets found in index.html')
}

let total = 0
for (const asset of assets) {
  const filename = resolve(root, asset.replace(/^\//, ''))
  const fromRoot = relative(root, filename)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`Startup asset is outside the build directory: ${asset}`)
  }
  const size = gzipSync(readFileSync(filename), { level: 6 }).byteLength
  total += size
  console.log(`${(size / 1024).toFixed(1).padStart(7)} KiB gzip  ${asset}`)
}
const limit = 650 * 1024
console.log(
  `Startup JS/CSS: ${(total / 1024).toFixed(1)} / ${limit / 1024} KiB gzip`
)
if (total > limit) {
  throw new Error(
    'Startup bundle exceeds its budget; inspect eager imports and route splitting'
  )
}
