// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const config = readFileSync(
  fileURLToPath(new URL('../../vite.config.ts', import.meta.url)),
  'utf-8',
)

describe('pwa config', () => {
  it('declares standalone manifest with icons and void theme', () => {
    expect(config).toContain("display: 'standalone'")
    expect(config).toContain("theme_color: '#0C0C0E'")
    expect(config).toContain('pwa-512.png')
    expect(config).toContain("purpose: 'maskable'")
  })

  it('does not pin orientation (reviewing photos in landscape is legitimate)', () => {
    expect(config).not.toContain('orientation:')
  })

  it('does not runtime-cache the api (online-only by design)', () => {
    expect(config).not.toContain('runtimeCaching')
    // el proxy de dev legítimamente contiene '/api'; lo prohibido es cachearlo
    expect(config).not.toMatch(/urlPattern.*api/)
  })

  it('excludes /api from the navigation fallback so the SW never swallows API calls', () => {
    expect(config).toContain('navigateFallbackDenylist')
    expect(config).toContain('navigateFallbackDenylist: [/^\\/api\\//]')
  })

  it('proxies /api with ws upgrade enabled (the progress WS lives under /api/v1/ws)', () => {
    expect(config).toContain('ws: true')
  })
})
