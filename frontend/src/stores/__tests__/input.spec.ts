import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInputStore } from '../input'
import type { InputDates, InputFile, InputSummary } from '@/types/api'

// mtime es epoch en SEGUNDOS (float), no una fecha ISO (contrato del backend)
const FILES: InputFile[] = [
  { path: 'a.jpg', name: 'a.jpg', size_bytes: 1024, mtime: 1785535200, kind: 'photo' },
  { path: 'b.mp4', name: 'b.mp4', size_bytes: 2048, mtime: 1785621600.5, kind: 'video' },
]
const SUMMARY: InputSummary = { photo: 1, video: 1, unknown: 0, total: 2 }
// años y meses llegan como STRINGS del backend (meses zero-padded)
const DATES: InputDates = {
  years: ['2023', '2025', '2024'],
  months_by_year: { '2024': ['08', '03', '12'] },
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

// mock de fetch por ruta: responde según el endpoint de input pedido
function routedFetch() {
  return vi.fn(async (url: string) => {
    if (url.startsWith('/api/v1/input/files')) return jsonResponse(FILES)
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

  it('refresh loads files + summary + dates in one go', async () => {
    vi.stubGlobal('fetch', routedFetch())
    const input = useInputStore()
    expect(input.loaded).toBe(false)

    await input.refresh()

    expect(input.files).toEqual(FILES)
    expect(input.summary).toEqual(SUMMARY)
    expect(input.dates).toEqual(DATES)
    expect(input.loading).toBe(false)
    expect(input.loaded).toBe(true)
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
        .forEach((resolve, i) => resolve(jsonResponse(i === 0 ? FILES : i === 1 ? SUMMARY : DATES)))

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

  it('removeFile issues the DELETE with the encoded path and refreshes afterwards', async () => {
    const routes = routedFetch()
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
      return routes(url)
    })
    vi.stubGlobal('fetch', fetchMock)

    const input = useInputStore()
    await input.removeFile('sub/a b.jpg')

    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')
    expect(deleteCall?.[0]).toBe('/api/v1/input/files?path=sub%2Fa%20b.jpg')
    // tras el DELETE se recargan las tres lecturas
    const reads = fetchMock.mock.calls.filter(([, init]) => init?.method !== 'DELETE').map(([url]) => url)
    expect(reads).toEqual(['/api/v1/input/files', '/api/v1/input/summary', '/api/v1/input/dates'])
    expect(input.files).toEqual(FILES)
  })

  it('applyInputChanged (WS input-changed) applies counts instantly and refreshes behind', async () => {
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
