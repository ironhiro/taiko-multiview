// Writes a .br and a .gz twin beside every compressible file in dist/, so the server can
// hand out compressed bytes without ever running a compressor itself.
//
// Compressing at build time rather than per request is deliberate. Vite names every asset
// after its content, the server marks those names immutable, and the container the dev
// environment runs in has a quarter of a vCPU: runtime compression would spend that CPU
// re-compressing identical bytes for every visitor arriving without a warm cache, on the
// request path, in front of the paint it is meant to make faster. Here it costs a few
// seconds of the build, once, and buys the highest setting each format offers.
//
// See PreCompressedStaticFiles.cs for the serving half.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'

const dist = fileURLToPath(new URL('../dist', import.meta.url))

// Formats that are already compressed (woff2, png, jpeg, …) only grow when squeezed again,
// so only the text-shaped output is listed. Anything not here is left alone.
const COMPRESSIBLE = new Set([
  '.css',
  '.js',
  '.mjs',
  '.html',
  '.json',
  '.svg',
  '.txt',
  '.map',
  '.webmanifest',
])

// Below roughly one network segment there is nothing left to win, and the twin costs a
// file lookup on every request for it.
const MINIMUM_BYTES = 1024

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* walk(path)
    } else if (entry.isFile()) {
      yield path
    }
  }
}

function brotli(buffer) {
  return brotliCompressSync(buffer, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      // A bigger window finds matches further back, which is what the long run of
      // near-identical @font-face blocks in the stylesheet needs.
      [constants.BROTLI_PARAM_LGWIN]: 24,
      [constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
    },
  })
}

function gzip(buffer) {
  return gzipSync(buffer, { level: constants.Z_BEST_COMPRESSION })
}

function kilobytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`
}

let files = 0
let before = 0
let after = 0

for (const path of walk(dist)) {
  if (!COMPRESSIBLE.has(extname(path).toLowerCase())) continue
  if (statSync(path).size < MINIMUM_BYTES) continue

  const original = readFileSync(path)
  const twins = [
    ['.br', brotli(original)],
    ['.gz', gzip(original)],
  ]

  let smallest = original.length
  for (const [suffix, compressed] of twins) {
    // A twin larger than what it replaces would only ever be the wrong answer to serve.
    if (compressed.length >= original.length) continue
    writeFileSync(path + suffix, compressed)
    smallest = Math.min(smallest, compressed.length)
  }

  if (smallest === original.length) continue

  files += 1
  before += original.length
  after += smallest

  console.log(
    `  ${relative(dist, path).replaceAll('\\', '/')}  ${kilobytes(original.length)} → ${kilobytes(smallest)}`,
  )
}

const saved = before === 0 ? 0 : 100 - (after / before) * 100

console.log(
  `precompress: ${files} file(s), ${kilobytes(before)} → ${kilobytes(after)} ` +
    `(-${saved.toFixed(1)}%) as .br and .gz`,
)
