import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInputStore } from '../input'
import type { InputDates, InputFile, InputSummary } from '@/types/api'

// mtime es epoch en SEGUNDOS (float), no una fecha ISO (contrato del backend)
const FILES: InputFile[] = [
  { path: 'a.jpg', name: 'a.jpg', size_bytes: 1024, mtime: 1785535200, kind: 'photo' },
  { path: 'b.mp4', name: 'b.mp4', size_bytes: 2048, mtime: 1785621600.5, kind: 'video' },
]
// el backend pagina: GET /input/files ahora devuelve {files, total} (no un
// array pelado). total es el recuento REAL del folder, no files.length
const PAGE = { files: FILES, total: FILES.length }
const SUMMARY: InputSummary = { photo: 1, video: 1, unknown: 0, total: 2 }
// años y meses llegan como STRINGS del backend (meses zero-padded)
const DATES: InputDates = {
  years: ['2023', '2025', '2024'],
  months_by_year: { '2024': ['08', '03', '12'] },
}

const file = (i: number): InputFile => ({
  path: `f${i}.jpg`,
  name: `f${i}.jpg`,
  size_bytes: 1,
  mtime: 1,
  kind: 'photo',
})

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

// mock de fetch por ruta: responde según el endpoint de input pedido
function routedFetch() {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/input/files')) return jsonResponse(PAGE)
    if (url.startsWith('/api/v1/input/summary')) return jsonResponse(SUMMARY)
    if (url.startsWith('/api/v1/input/dates')) return jsonResponse(DATES)
    throw new Error(`ruta sin mock: ${url}`)
  })
}

// mock paginado: sirve la página según el offset de la query (?offset=)
function paginatedFetch(pages: Record<number, { files: InputFile[]; total: number }>) {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/input/files')) {
      const offset = Number(new URL(url, 'http://x').searchParams.get('offset'))
      return jsonResponse(pages[offset])
    }
    if (url.startsWith('/api/v1/input/summary')) return jsonResponse(SUMMARY)
    if (url.startsWith('/api/v1/input/dates')) return jsonResponse(DATES)
    throw new Error(`ruta sin mock: ${url}`)
  })
}

describe('stores/input', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refresh loads the first page (files + total) + summary + dates in one go', async () => {
    vi.stubGlobal('fetch', routedFetch())
    const input = useInputStore()
    expect(input.loaded).toBe(false)

    await input.refresh()

    // pide explícitamente la página 1 (offset=0, limit=PAGE_SIZE)
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const filesCall = fetchMock.mock.calls.find(([u]) => String(u).startsWith('/api/v1/input/files'))
    expect(filesCall?.[0]).toBe('/api/v1/input/files?limit=200&offset=0')

    expect(input.files).toEqual(FILES)
    expect(input.total).toBe(2)
    // 2 cargados de 2 totales → no quedan páginas
    expect(input.hasMore).toBe(false)
    expect(input.summary).toEqual(SUMMARY)
    expect(input.dates).toEqual(DATES)
    expect(input.loading).toBe(false)
    expect(input.loaded).toBe(true)
  })

  it('refresh resets to page 1, discarding previously accumulated pages', async () => {
    vi.stubGlobal('fetch', routedFetch())
    const input = useInputStore()
    // simula varias páginas ya apiladas de una sesión anterior
    input.files = [...FILES, file(9)]
    input.total = 99

    await input.refresh()

    // vuelve EXACTAMENTE a la primera página del server, sin restos
    expect(input.files).toEqual(FILES)
    expect(input.total).toBe(2)
  })

  it('loadMore appends the next page and stops (hasMore false) once every page is in', async () => {
    const first = { files: [file(0), file(1)], total: 4 }
    const second = { files: [file(2), file(3)], total: 4 }
    vi.stubGlobal('fetch', paginatedFetch({ 0: first, 2: second }))
    const input = useInputStore()

    await input.refresh()
    expect(input.files).toHaveLength(2)
    expect(input.hasMore).toBe(true)

    await input.loadMore()
    // la página siguiente se APILA sobre la primera (no la reemplaza)
    expect(input.files.map((f) => f.path)).toEqual(['f0.jpg', 'f1.jpg', 'f2.jpg', 'f3.jpg'])
    expect(input.total).toBe(4)
    expect(input.hasMore).toBe(false)

    // sin más páginas → no-op, no dispara otra petición
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length
    await input.loadMore()
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before)
  })

  it('loadMore ignores a concurrent second call while a page is in flight', async () => {
    let resolvePage!: (r: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvePage = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const input = useInputStore()
    // estado sembrado: 2 de 4 cargados → hay página siguiente
    input.files = [file(0), file(1)]
    input.total = 4

    const a = input.loadMore()
    const b = input.loadMore() // llega con la primera en vuelo → no-op
    // una sola petición pese a las dos llamadas
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolvePage(jsonResponse({ files: [file(2), file(3)], total: 4 }))
    await Promise.all([a, b])

    expect(input.files.map((f) => f.path)).toEqual(['f0.jpg', 'f1.jpg', 'f2.jpg', 'f3.jpg'])
    expect(input.loadingMore).toBe(false)
  })

  it('requeue-aware refresh: a caller arriving mid-flight chains ONE fresh round after the current', async () => {
    // fetch que no resuelve hasta que el test lo ordene: mantiene el refresh
    // "en vuelo" mientras se lanza una llamada concurrente
    const resolvers: Array<(r: Response) => void> = []
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve)
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const drainRound = (from: number) =>
      resolvers
        .slice(from, from + 3)
        .forEach((resolve, i) => resolve(jsonResponse(i === 0 ? PAGE : i === 1 ? SUMMARY : DATES)))

    const input = useInputStore()
    const first = input.refresh()
    // el segundo caller llega con la ronda en vuelo: NO comparte esos datos ya
    // viejos (p.ej. un input-changed a mitad de fetch), sino que encadena una
    // ronda fresca cuando la actual resuelva
    const second = input.refresh()

    // mientras la primera ronda no resuelve, el requeue aún no ha disparado:
    // solo las 3 peticiones de la ronda en vuelo
    expect(fetchMock).toHaveBeenCalledTimes(3)

    drainRound(0)
    await first
    // resuelta la primera, el caller en vuelo dispara UNA ronda fresca
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))

    drainRound(3)
    await second
    expect(input.files).toEqual(FILES)

    // sin callers en vuelo, un refresh nuevo abre su propia ronda (no encadena)
    const third = input.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(9)
    drainRound(6)
    await third
  })

  it('exposes EXIF suggestions: STRING years newest-first, STRING months ascending per year', async () => {
    vi.stubGlobal('fetch', routedFetch())
    const input = useInputStore()
    await input.refresh()

    // strings ordenados NUMÉRICAMENTE, no lexicográficamente; meses zero-padded
    expect(input.suggestedYears).toEqual(['2025', '2024', '2023'])
    expect(input.monthsForYear('2024')).toEqual(['03', '08', '12'])
    // año sin fotos → sin sugerencias, nunca undefined
    expect(input.monthsForYear('1999')).toEqual([])
  })

  it('removeFile DELETEs the encoded path, drops it locally + decrements total, refreshes only summary', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
      if (url.startsWith('/api/v1/input/summary')) return jsonResponse(SUMMARY)
      throw new Error(`ruta sin mock: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const input = useInputStore()
    // ruta con subcarpeta y espacio para verificar el encoding del DELETE
    const withSub: InputFile = { path: 'sub/a b.jpg', name: 'a b.jpg', size_bytes: 1024, mtime: 1785535200, kind: 'photo' }
    input.files = [withSub, FILES[1]]
    input.total = 2

    await input.removeFile('sub/a b.jpg')

    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(deleteCall?.[0]).toBe('/api/v1/input/files?path=sub%2Fa%20b.jpg')
    // borrado LOCAL (no se recarga el listado) + total decrementado
    expect(input.files.map((f) => f.path)).toEqual(['b.mp4'])
    expect(input.total).toBe(1)
    // tras el DELETE solo se recarga el summary (badges), NO files ni dates
    const reads = fetchMock.mock.calls.filter(([, init]) => init?.method !== 'DELETE').map(([url]) => url)
    expect(reads).toEqual(['/api/v1/input/summary'])
    expect(input.summary).toEqual(SUMMARY)
  })

  it('applyInputChanged (WS input-changed) applies counts instantly and refreshes page 1 behind', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)

    const input = useInputStore()
    const counts: InputSummary = { photo: 9, video: 2, unknown: 1, total: 12 }
    input.applyInputChanged(counts)

    // los counts del mensaje se ven YA, sin esperar la red
    expect(input.summary).toEqual(counts)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await vi.waitFor(() => {
      expect(input.files).toEqual(FILES)
    })
    // y el summary termina siendo el del server (fuente de verdad)
    expect(input.summary).toEqual(SUMMARY)
  })
})
