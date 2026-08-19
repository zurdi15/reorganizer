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

// IntersectionObserver de mentira: captura las instancias creadas y expone
// trigger() para simular que el sentinel entra en viewport
class MockIO {
  static instances: MockIO[] = []
  cb: IntersectionObserverCallback
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
    MockIO.instances.push(this)
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  trigger() {
    this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
  }
}

async function mountGrid(
  seed: { files?: InputFile[]; summary?: InputSummary | null; total?: number } = {},
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const input = useInputStore()
  input.files = seed.files ?? FILES
  // total por defecto = nº de archivos sembrados → hasMore false (todo cargado)
  input.total = seed.total ?? (seed.files ?? FILES).length
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
      if (url.includes('/input/files')) return jsonResponse({ files: FILES, total: FILES.length })
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
    // ruta con subcarpeta y espacio: encodeURIComponent + thumb=1 SIEMPRE, y
    // el mtime como versión (deja cachear la miniatura para siempre)
    expect(thumbs[0].attributes('src')).toBe(
      '/api/v1/input/preview?path=sub%2Fa%20b.jpg&thumb=1&v=1785535200',
    )
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
    // /upload es una ruta con carga perezosa: la navegación no termina hasta
    // que su chunk resuelve (por eso waitFor y no un solo flush)
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('upload')
    })
  })

  it('the refresh button re-requests the three input reads', async () => {
    const { wrapper } = await mountGrid()
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(fetchMock).not.toHaveBeenCalled()

    await wrapper.get('[data-testid="input-refresh"]').trigger('click')
    await flushPromises()

    const urls = fetchMock.mock.calls.map(([url]) => url)
    // el listado se pide paginado a la página 1 (offset=0, limit=PAGE_SIZE)
    expect(urls).toEqual([
      '/api/v1/input/files?limit=200&offset=0',
      '/api/v1/input/summary',
      '/api/v1/input/dates',
    ])
  })

  it('renders the scroll sentinel + spinner only while more pages remain, and drops them once fully loaded', async () => {
    // hasMore = 3 cargados < 5 totales → sentinel presente, sin fila de carga
    const { wrapper } = await mountGrid({ total: 5 })
    expect(wrapper.find('[data-testid="input-sentinel"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="input-loading-more"]').exists()).toBe(false)
    // el contador muestra el TOTAL del folder (5), no los 3 cargados
    expect(wrapper.get('[data-testid="input-count"]').text()).toBe('5 archivos')

    // todo cargado → ni sentinel ni fila de carga
    const { wrapper: full } = await mountGrid({ total: 3 })
    expect(full.find('[data-testid="input-sentinel"]').exists()).toBe(false)
  })

  it('the scroll sentinel calls loadMore (next page, offset = loaded count) when it intersects', async () => {
    MockIO.instances = []
    vi.stubGlobal('IntersectionObserver', MockIO)
    const PAGE2: InputFile[] = [
      { path: 'p3.jpg', name: 'p3.jpg', size_bytes: 1, mtime: 1, kind: 'photo' },
      { path: 'p4.jpg', name: 'p4.jpg', size_bytes: 1, mtime: 1, kind: 'photo' },
      { path: 'p5.jpg', name: 'p5.jpg', size_bytes: 1, mtime: 1, kind: 'photo' },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/input/files')) {
          const offset = Number(new URL(url, 'http://x').searchParams.get('offset'))
          return jsonResponse(offset >= 3 ? { files: PAGE2, total: 6 } : { files: FILES, total: 6 })
        }
        if (url.includes('/input/summary')) return jsonResponse(SUMMARY)
        if (url.includes('/input/dates')) return jsonResponse({ years: [], months_by_year: {} })
        throw new Error(`ruta sin mock: ${url}`)
      }),
    )

    // 3 cargados de 6 → hay página siguiente
    const { input } = await mountGrid({ total: 6 })
    expect(input.hasMore).toBe(true)

    const io = MockIO.instances.at(-1)
    expect(io).toBeDefined()
    io!.trigger()
    await flushPromises()

    // se pidió la página siguiente (offset = nº cargado) y se apiló
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const filesCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/input/files'))
    expect(String(filesCall?.[0])).toContain('offset=3')
    expect(input.files.map((f) => f.path)).toEqual([
      'sub/a b.jpg',
      'DJI_0042.MP4',
      'notas.txt',
      'p3.jpg',
      'p4.jpg',
      'p5.jpg',
    ])
    expect(input.hasMore).toBe(false)
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
