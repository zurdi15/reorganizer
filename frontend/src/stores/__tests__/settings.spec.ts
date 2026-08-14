import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/api/client'
import type { RuleRead } from '@/api/rules'
import type { Settings } from '@/types/api'
import { useSettingsStore } from '../settings'

const SETTINGS: Settings = {
  immich_enabled: false,
  immich_url: '',
  immich_api_key: '',
  immich_library_id: '',
  default_duplicate_strategy: 'rename',
  default_transfer_mode: 'move',
  upload_duplicate_strategy: 'skip',
}

function makeRule(id: number, priority: number, over: Partial<RuleRead> = {}): RuleRead {
  return {
    id,
    priority,
    enabled: true,
    name: null,
    media_type: null,
    orientation: null,
    filename_regex: null,
    camera_make: null,
    camera_model: null,
    dest_template: 'photo',
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    ...over,
  }
}

const RULES = [makeRule(1, 10), makeRule(2, 20), makeRule(3, 30)]

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

function routedFetch() {
  return vi.fn(async (url: string) => {
    if (url === '/api/v1/settings') return jsonResponse(SETTINGS)
    if (url === '/api/v1/rules') return jsonResponse(RULES)
    throw new Error(`ruta sin mock: ${url}`)
  })
}

describe('stores/settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('ensureLoaded loads settings + rules once and dedupes concurrent AND later callers', async () => {
    const fetchMock = routedFetch()
    vi.stubGlobal('fetch', fetchMock)
    const store = useSettingsStore()

    const first = store.ensureLoaded()
    const second = store.ensureLoaded()
    // dos llamadas concurrentes → UNA ronda de 2 peticiones
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await Promise.all([first, second])

    expect(store.settings).toEqual(SETTINGS)
    expect(store.rules).toEqual(RULES)
    expect(store.loaded).toBe(true)

    // ya cargado: NO se vuelve a pedir (a diferencia del refresh del input,
    // los ajustes solo cambian desde esta misma vista)
    await store.ensureLoaded()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('a failed load leaves loaded=false so ensureLoaded can retry', async () => {
    const failing = vi.fn(async () => jsonResponse({ detail: 'generic' }, 500))
    vi.stubGlobal('fetch', failing)
    const store = useSettingsStore()

    await expect(store.ensureLoaded()).rejects.toBeInstanceOf(ApiError)
    expect(store.loaded).toBe(false)

    // el reintento sí dispara una ronda nueva
    vi.stubGlobal('fetch', routedFetch())
    await store.ensureLoaded()
    expect(store.loaded).toBe(true)
  })

  it('save sends the partial as-is and NEVER keeps the real api key: state mirrors the masked server response', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return jsonResponse({ ...SETTINGS, immich_url: 'http://immich.local', immich_api_key: '****1234' })
      }
      throw new Error(`ruta sin mock: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useSettingsStore()

    await store.save({ immich_url: 'http://immich.local', immich_api_key: 'supersecret1234' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/settings')
    expect(JSON.parse(init?.body as string)).toEqual({
      immich_url: 'http://immich.local',
      immich_api_key: 'supersecret1234',
    })
    // el estado es la respuesta del server (key enmascarada), no lo tecleado
    expect(store.settings?.immich_api_key).toBe('****1234')
  })

  it('reorder is optimistic and rolls back on server rejection', async () => {
    let rejectFetch: (response: Response) => void = () => {}
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          rejectFetch = resolve
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const store = useSettingsStore()
    store.rules = [...RULES]

    const pending = store.reorder([2, 1, 3])
    // optimista: el nuevo orden se ve YA, antes de que el server conteste
    expect(store.rules.map((r) => r.id)).toEqual([2, 1, 3])

    rejectFetch(jsonResponse({ detail: 'invalid_rule_order' }, 422))
    await expect(pending).rejects.toMatchObject({ slug: 'invalid_rule_order' })

    // rollback al snapshot previo
    expect(store.rules.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('reorder success adopts the canonical server list (rewritten priorities)', async () => {
    const reordered = [makeRule(2, 10), makeRule(1, 20), makeRule(3, 30)]
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('/api/v1/rules/reorder')
      expect(JSON.parse(init?.body as string)).toEqual({ ids: [2, 1, 3] })
      return jsonResponse(reordered)
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = useSettingsStore()
    store.rules = [...RULES]

    await store.reorder([2, 1, 3])
    expect(store.rules).toEqual(reordered)
  })

  it('moveRule builds the full id permutation and is a no-op at the edges', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      jsonResponse(JSON.parse(init?.body as string).ids.map((id: number, i: number) => makeRule(id, (i + 1) * 10))),
    )
    vi.stubGlobal('fetch', fetchMock)
    const store = useSettingsStore()
    store.rules = [...RULES]

    // borde superior: no-op sin red
    await store.moveRule(1, -1)
    expect(fetchMock).not.toHaveBeenCalled()

    await store.moveRule(3, -1)
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ ids: [1, 3, 2] })
  })

  it('toggleRule flips optimistically and rolls back when the PATCH fails', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ detail: 'rule_not_found' }, 404))
    vi.stubGlobal('fetch', fetchMock)
    const store = useSettingsStore()
    store.rules = [...RULES]

    await expect(store.toggleRule(1, false)).rejects.toMatchObject({ slug: 'rule_not_found' })
    expect(store.rules.find((r) => r.id === 1)?.enabled).toBe(true)
  })
})
