// Genera src/styles/tokens.css desde src/tokens/index.ts. Determinista:
// mismo input, mismo output byte a byte (el diff de git delata drift).
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { themes, core } = await import(resolve(here, '../src/tokens/index.ts'))

const colorVars = (theme) =>
  Object.entries(theme)
    .map(([key, value]) => `  --rg-${key}: ${value};`)
    .join('\n')

const coreVars = Object.entries(core)
  .flatMap(([group, values]) =>
    Object.entries(values).map(([key, value]) => `  --rg-${group}-${key}: ${value};`),
  )
  .join('\n')

const css = `/* GENERADO por scripts/build-tokens.mjs — no editar a mano. */
:root {
${colorVars(themes.dark)}
${coreVars}
}

html.rg-light {
${colorVars(themes.light)}
}
`

const out = resolve(here, '../src/styles/tokens.css')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, css)
console.log(`tokens.css: ${css.split('\n').length} lines`)
