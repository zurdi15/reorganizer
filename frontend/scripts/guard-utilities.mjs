#!/usr/bin/env node
// Tailwind 4 descarta en silencio cualquier utilidad que no reconoce: un
// bg-ink-subtle mal escrito compila sin error y solo se nota mirando la app
// (pasó 3 veces en berserk, de donde se hereda este guard). Extrae toda
// utilidad de color usada en src/ y confirma que de verdad generó CSS en el
// build — grepear dist/assets es la única fuente de verdad porque ahí está
// lo que Tailwind realmente reconoció.
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcDir = join(here, '../src')
const distAssetsDir = join(here, '../dist/assets')

const CANDIDATE_RE =
  /(?:^|[\s'"`:{])((?:hover:|focus:|active:|disabled:)*(?:bg|text|border|ring|fill|stroke|divide|outline|decoration)-[a-z][a-z0-9/-]*)/g

// Construido empíricamente: falsos positivos inspeccionados uno a uno
// (nunca por prefijo).
const WHITELIST = new Set([
  // atributos de presentación SVG, no clases de Tailwind — `:stroke-width`,
  // `stroke-linecap` y `stroke-linejoin` (RgIcon.vue) matchean el mismo
  // prefijo `stroke-` que la utilidad de color `stroke-*`, pero Tailwind
  // nunca genera CSS para ellos porque no son utilidades.
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-width',
])

function collectFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(vue|ts)$/.test(e.name) && !e.parentPath.includes('__tests__'))
    .map((e) => join(e.parentPath, e.name))
}

function extractUtilities(content) {
  const found = new Set()
  for (const match of content.matchAll(CANDIDATE_RE)) {
    const utility = match[1]
      .replace(/^(?:hover:|focus:|active:|disabled:)+/, '')
      .replace(/\/\d+$/, '')
    found.add(utility)
  }
  return found
}

const utilities = new Set()
for (const file of collectFiles(srcDir)) {
  const content = readFileSync(file, 'utf8')
  for (const utility of extractUtilities(content)) utilities.add(utility)
}

let cssFiles
try {
  cssFiles = readdirSync(distAssetsDir).filter((f) => f.endsWith('.css'))
} catch {
  cssFiles = []
}
if (cssFiles.length === 0) {
  console.error('✗ guard:utilities — no se encontró CSS en dist/assets; corre `npm run build` primero')
  process.exit(1)
}
const css = cssFiles.map((f) => readFileSync(join(distAssetsDir, f), 'utf8')).join('\n')

const missing = [...utilities]
  .filter((utility) => !WHITELIST.has(utility))
  .filter((utility) => !css.includes(utility))
  .sort()

if (missing.length > 0) {
  console.error('✗ utilidades de color usadas en src/ que no generaron CSS (clase inventada o typo):')
  for (const utility of missing) console.error(`  ${utility}`)
  process.exit(1)
}

console.log(`✓ guard:utilities — ${utilities.size} utilidades de color verificadas contra dist/assets/*.css`)
