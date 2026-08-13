// @vitest-environment node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { core, themes } from '../index'

const css = readFileSync(
  fileURLToPath(new URL('../../styles/tokens.css', import.meta.url)),
  'utf-8',
)

// WCAG 2.x relative-luminance contrast ratio — implementación mínima y
// autocontenida (sin dependencia nueva) para poder hacer del 4.5:1 de AA una
// aserción automática, no solo una nota en un comentario.
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number]
}
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA)) + 0.05
  const lB = relativeLuminance(hexToRgb(hexB)) + 0.05
  return lA > lB ? lA / lB : lB / lA
}

describe('token pipeline', () => {
  it('light theme redefines exactly the dark color keys', () => {
    expect(Object.keys(themes.light).sort()).toEqual(Object.keys(themes.dark).sort())
  })

  describe('WCAG AA contrast regression (accents are used as real TEXT: badges, counters, errors)', () => {
    const lightAccents = ['accent-amber', 'accent-cobalt', 'ok', 'danger'] as const
    for (const accent of lightAccents) {
      it(`light ${accent} on bg-stone clears 4.5:1`, () => {
        expect(contrastRatio(themes.light[accent], themes.light['bg-stone'])).toBeGreaterThanOrEqual(4.5)
      })
    }
    it('light accent-amber-deep clears 4.5:1 and reads as a visibly darker step than accent-amber', () => {
      expect(contrastRatio(themes.light['accent-amber-deep'], themes.light['bg-stone'])).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(themes.light['accent-amber-deep'], themes.light['bg-stone']))
        .toBeGreaterThan(contrastRatio(themes.light['accent-amber'], themes.light['bg-stone']))
    })
    it('light accent-cobalt-deep clears 4.5:1 and reads as a visibly darker step than accent-cobalt', () => {
      expect(contrastRatio(themes.light['accent-cobalt-deep'], themes.light['bg-stone'])).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(themes.light['accent-cobalt-deep'], themes.light['bg-stone']))
        .toBeGreaterThan(contrastRatio(themes.light['accent-cobalt'], themes.light['bg-stone']))
    })
    it('light ink on bg-void clears 7:1 (body text, AAA-grade headroom)', () => {
      expect(contrastRatio(themes.light['ink'], themes.light['bg-void'])).toBeGreaterThanOrEqual(7)
    })
    const darkAccents = ['accent-amber', 'accent-cobalt', 'ok', 'danger'] as const
    for (const accent of darkAccents) {
      it(`dark ${accent} on bg-stone clears 4.5:1`, () => {
        expect(contrastRatio(themes.dark[accent], themes.dark['bg-stone'])).toBeGreaterThanOrEqual(4.5)
      })
    }
  })

  it('accent split is respected: amber is the photo/primary accent, cobalt the video accent', () => {
    expect(themes.dark['accent-amber']).toBe('#F5A93F')
    expect(themes.dark['accent-cobalt']).toBe('#5CA8FF')
  })

  it('darkroom greys are chromatically neutral: every bg/line/ink grey has max channel spread ≤ 6 (no blue tint — berserk ink-muted spreads 24)', () => {
    const greyKeys = ['bg-void', 'bg-stone', 'bg-slab', 'line', 'line-strong', 'ink', 'ink-muted', 'ink-faint'] as const
    for (const theme of [themes.dark, themes.light]) {
      for (const key of greyKeys) {
        const [r, g, b] = hexToRgb(theme[key])
        expect(Math.max(r, g, b) - Math.min(r, g, b), `${key} ${theme[key]}`).toBeLessThanOrEqual(6)
      }
    }
  })

  it('generated css contains every dark token as --rg-* on :root', () => {
    for (const key of Object.keys(themes.dark)) {
      expect(css).toContain(`--rg-${key}:`)
    }
    expect(css).toMatch(/^:root \{/m)
    expect(css).toMatch(/^html\.rg-light \{/m)
  })

  it('generated css contains core tokens (durations, easings)', () => {
    expect(css).toContain('--rg-dur-3: 320ms')
    expect(css).toContain('--rg-ease-spring: cubic-bezier(0.34, 1.4, 0.44, 1)')
  })

  it('the html.rg-light block redefines every single light key, not just a subset (a silently-missing key would leave that surface stuck on the dark value)', () => {
    const lightBlock = css.slice(css.indexOf('html.rg-light {'))
    for (const key of Object.keys(themes.light)) {
      expect(lightBlock).toContain(`--rg-${key}:`)
    }
  })

  it('scrim/slab-shadow differ between themes (they exist precisely because a single dark-authored value looks wrong inverted)', () => {
    expect(themes.light.scrim).not.toBe(themes.dark.scrim)
    expect(themes.light['slab-shadow']).not.toBe(themes.dark['slab-shadow'])
  })

  it('no noise token: the darkroom chrome is texture-free by design (deliberate deviation from berserk)', () => {
    expect(css).not.toContain('noise')
  })

  it('spacing is not a token: Tailwind\'s own scale is the spacing system', () => {
    expect(css).not.toContain('--rg-space-')
  })
})
