import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputGrid from '../InputGrid.vue'
import { createI18nInstance } from '@/i18n'
import { router } from '@/router'
import { useInputStore } from '@/stores/input'
import type { InputFile, InputSummary } from '@/types/api'

const FILES: InputFile[] = [
  { path: 'sub/a b.jpg', name: 'a b.jpg', size_bytes: 1024, mtime: 1785535200, kind: 'photo' },
  { path: 'DJI_0042.MP4', name: 'DJI_0042.MP4', size_bytes: 4096, mtime: 1785621600, kind: 'video' },
  { path: 'notas.txt', name: 'notas.txt', size_bytes: 12, mtime: 1785708000, kind: 'unknown' },
]
const SUMMARY: InputSummary = { photo: 1, video: 1, unknown: 1, total: 3 }

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

async function mountGrid(seed: { files?: InputFile[]; summary?: InputSummary | null } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const input = useInputStore()
  input.files = seed.files ?? FILES
  input.summary = 'summary' in seed ? (seed.summary ?? null) : SUMMARY
  input.loaded = true

  await router.push({ name: 'organize' })
  await router.isReady()

  const wrapper = mount(InputGrid, {
    global: { plugins: [pinia, router, createI18nInstance()] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, input }
}

describe('InputGrid', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/input/files')) return jsonResponse(FILES)
      if (url.includes('/input/summary')) return jsonResponse(SUMMARY)
      if (url.includes('/input/dates')) return jsonResponse({ years: [], months_by_year: {} })
      if (url.includes('/input/probe')) {
        return jsonResponse({
          media_type: 'photo',
          orientation: 'horizontal',
          taken_at: null,
          camera_make: null,
          camera_model: null,
          matched_rule_id: null,
          planned_subpath: null,
        })
      }
      throw new Error(`ruta sin mock: ${url}`)
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders one square card per file, with lazy ?thumb=1 previews and kind badges', async () => {
    const { wrapper } = await mountGrid()

    const cards = wrapper.findAll('[data-testid="input-card"]')
    expect(cards).toHaveLength(3)

    // solo foto y vídeo llevan thumb (el server no genera para unknown)
    const thumbs = wrapper.findAll('[data-testid="input-card-thumb"]')
    expect(thumbs).toHaveLength(2)
    expect(thumbs[0].attributes('loading')).toBe('lazy')
    // ruta con subcarpeta y espacio: encodeURIComponent + thumb=1 SIEMPRE
    expect(thumbs[0].attributes('src')).toBe('/api/v1/input/preview?path=sub%2Fa%20b.jpg&thumb=1')
    expect(thumbs[1].attributes('src')).toContain('&thumb=1')

    expect(wrapper.get('[data-testid="input-count"]').text()).toBe('3 archivos')
  })

  it('shows the warning strip only when unknown > 0', async () => {
    const { wrapper, input } = await mountGrid()
    expect(wrapper.get('[data-testid="unknown-strip"]').text()).toContain('_unknown/')

    input.summary = { ...SUMMARY, unknown: 0 }
    await nextTick()
    expect(wrapper.find('[data-testid="unknown-strip"]').exists()).toBe(false)
  })

  it('renders the empty state with a link to /upload when the input is empty', async () => {
    const { wrapper } = await mountGrid({ files: [], summary: { photo: 0, video: 0, unknown: 0, total: 0 } })

    expect(wrapper.find('[data-testid="input-grid"]').exists()).toBe(false)
    const action = wrapper.get('[data-testid="input-empty-upload"]')
    await action.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('upload')
  })

  it('the refresh button re-requests the three input reads', async () => {
    const { wrapper } = await mountGrid()
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(fetchMock).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="input-refresh"]').trigger('click')
    await flushPromises()

    const urls = fetchMock.mock.calls.map(([url]) => url)
    expect(urls).toEqual(['/api/v1/input/files', '/api/v1/input/summary', '/api/v1/input/dates'])
  })

  it('tapping a card opens the detail sheet (probe-on-open) with the file name as TEXT (anti-XSS)', async () => {
    const hostile: InputFile = {
      path: '<img src=x onerror=alert(1)>.jpg',
      name: '<img src=x onerror=alert(1)>.jpg',
      size_bytes: 55,
      mtime: 1785535200,
      kind: 'photo',
    }
    const { wrapper } = await mountGrid({ files: [hostile], summary: { photo: 1, video: 0, unknown: 0, total: 1 } })

    await wrapper.get('[data-testid="input-card"]').trigger('click')
    await flushPromises()

    // la sheet teleporta a body: se consulta el documento
    const filename = document.querySelector('[data-testid="sheet-filename"]') as HTMLElement
    expect(filename.textContent).toContain('<img src=x onerror=alert(1)>.jpg')
    // el nombre JAMÁS se interpreta como HTML: ese <img src=x> no existe
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })
})
