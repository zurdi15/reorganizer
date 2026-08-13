// @vitest-environment node
//
// index.html lleva un <script> inline que aplica html.rg-light y el meta
// theme-color ANTES del primer paint (evita el flash — ver el why-comment
// junto al script). Ese script duplica a mano los hex de
// themes.dark/light['bg-void'] porque no puede importar tokens/index.ts sin
// romper el bloqueo síncrono. Este test es el drift gate: si alguien cambia
// bg-void en la fuente de verdad sin actualizar el script (o viceversa),
// esto falla. También ancla el theme_color del manifest PWA al mismo token.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { themes } from '../tokens'

const html = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf-8')
const viteConfig = readFileSync(fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), 'utf-8')

describe('index.html theme FOUC guard', () => {
  it('is a synchronous inline script, not a module and not deferred (both would run too late)', () => {
    const scriptTag = html.slice(html.indexOf('<script>'), html.indexOf('</script>') + '</script>'.length)
    expect(scriptTag.startsWith('<script>')).toBe(true)
    expect(scriptTag).not.toContain('type="module"')
    expect(scriptTag).not.toContain('defer')
    expect(scriptTag).not.toContain('async')
  })

  it('the hardcoded dark/light void hex match tokens/index.ts exactly (drift gate)', () => {
    expect(html).toContain(`'${themes.dark['bg-void']}'`)
    expect(html).toContain(`'${themes.light['bg-void']}'`)
  })

  it('reads the same localStorage key uiPrefs.ts uses for the theme preference', () => {
    expect(html).toContain("localStorage.getItem('rg:theme')")
  })

  it('resolves system mode via matchMedia(prefers-color-scheme: light), same query utils/theme.ts uses', () => {
    expect(html).toContain("matchMedia('(prefers-color-scheme: light)')")
  })

  it('applies the class and updates theme-color, guarded by try/catch (never breaks boot)', () => {
    const scriptTag = html.slice(html.indexOf('<script>'), html.indexOf('</script>'))
    expect(scriptTag).toContain("classList.add('rg-light')")
    expect(scriptTag).toContain('meta[name="theme-color"]')
    expect(scriptTag).toMatch(/try\s*\{/)
    expect(scriptTag).toMatch(/catch/)
  })

  it('runs before main.ts in document order (placed in <head>, script tag comes first)', () => {
    const inlineScriptIdx = html.indexOf("localStorage.getItem('rg:theme')")
    const mainTsIdx = html.indexOf('/src/main.ts')
    expect(inlineScriptIdx).toBeGreaterThan(-1)
    expect(mainTsIdx).toBeGreaterThan(-1)
    expect(inlineScriptIdx).toBeLessThan(mainTsIdx)
  })

  it('the static theme-color meta and the PWA manifest theme/background colors all equal dark bg-void', () => {
    expect(html).toContain(`<meta name="theme-color" content="${themes.dark['bg-void']}" />`)
    expect(viteConfig).toContain(`theme_color: '${themes.dark['bg-void']}'`)
    expect(viteConfig).toContain(`background_color: '${themes.dark['bg-void']}'`)
  })
})
