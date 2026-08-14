import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useJobsStore } from '../jobs'
import { useOrganizeStore } from '../organize'
import { useToastStore } from '../toast'
import type { JobRead } from '@/types/api'

function makeJob(over: Partial<JobRead> = {}): JobRead {
  return {
    id: 7,
    status: 'planning',
    dest_path: '2024/08/croacia',
    transfer_mode: 'move',
    duplicate_strategy: 'rename',
    total: 0,
    done: 0,
    errors: 0,
    skipped: 0,
    error: null,
    immich_status: null,
    created_at: '2026-08-13T10:00:00Z',
    started_at: null,
    finished_at: null,
    ...over,
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

// mock de fetch por defecto: cubre las lecturas de fondo que los watchers del
// store disparan solos (items del plan, job final, refresh del input)
function defaultFetchMock(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    for (const [needle, data] of Object.entries(overrides)) {
      if (url.includes(needle) && (init?.method ?? 'GET') !== 'POST') return jsonResponse(data)
    }
    if (url.includes('/input/files')) return jsonResponse({ files: [], total: 0 })
    if (url.includes('/input/summary')) return jsonResponse({ photo: 0, video: 0, unknown: 0, total: 0 })
    if (url.includes('/input/dates')) return jsonResponse({ years: [], months_by_year: {} })
    if (url.includes('/items')) return jsonResponse([])
    if (/\/jobs\/\d+$/.test(url)) return jsonResponse(makeJob({ status: 'completed' }))
    return jsonResponse([])
  })
}

describe('stores/organize', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', defaultFetchMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('segment ops: add validates via utils/path, remove by index and last', () => {
    const organize = useOrganizeStore()

    expect(organize.addSegment(' 2024 ')).toBe(true)
    expect(organize.addSegment('08')).toBe(true)
    // inválidos: traversal, separadores y prohibidos de Windows
    expect(organize.addSegment('..')).toBe(false)
    expect(organize.addSegment('a/b')).toBe(false)
    expect(organize.addSegment('foo:bar')).toBe(false)
    expect(organize.destSegments).toEqual(['2024', '08'])
    expect(organize.destPath).toBe('2024/08')

    organize.addSegment('croacia')
    organize.removeSegment(1)
    expect(organize.destSegments).toEqual(['2024', 'croacia'])
    organize.removeLastSegment()
    expect(organize.destSegments).toEqual(['2024'])
  })

  it('setFromPath seeds segments dropping the invalid ones', () => {
    const organize = useOrganizeStore()
    organize.setFromPath('2025/../ 05 /roma')
    // '..' se normaliza a vacío y cae; los espacios de los extremos se recortan
    expect(organize.destSegments).toEqual(['2025', '05', 'roma'])
  })

  it('derives the stage from the tracked job: adoption → plan → running → done (with final fetch)', async () => {
    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    expect(organize.stage).toBe('compose')

    // un job vivo que aparece (state-sync tras reload) se adopta solo y
    // siembra los segmentos desde su dest_path
    jobs.activeJob = makeJob({ status: 'planning' })
    await nextTick()
    expect(organize.stage).toBe('plan')
    expect(organize.currentJobId).toBe(7)
    expect(organize.destSegments).toEqual(['2024', '08', 'croacia'])

    jobs.activeJob!.status = 'planned'
    await nextTick()
    expect(organize.stage).toBe('plan')

    jobs.activeJob!.status = 'running'
    await nextTick()
    expect(organize.stage).toBe('running')

    // terminal: el store de jobs vacía activeJob y organize pasa a done,
    // pidiendo el estado final autoritativo por REST
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 7, status: 'completed' } })
    await nextTick()
    expect(organize.stage).toBe('done')
    await vi.waitFor(() => {
      expect(organize.currentJob?.status).toBe('completed')
    })

    // "Organizar más": suelta el job y refresca el input
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockClear()
    organize.reset()
    expect(organize.stage).toBe('compose')
    await vi.waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => url)
      // el listado ahora se pide paginado (?limit&offset) → prefijo, no exacto
      expect(urls.some((url) => typeof url === 'string' && url.startsWith('/api/v1/input/files'))).toBe(true)
    })
  })

  it('createPlan POSTs dest_path only (server defaults) and tracks the created job', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/jobs' && init?.method === 'POST') {
        return jsonResponse(makeJob({ status: 'planning' }), 202)
      }
      // re-fetch REST anti-cuelgue (job que vuelve del POST aún en planning)
      const m = /\/jobs\/(\d+)$/.exec(url)
      if (m) return jsonResponse(makeJob({ id: Number(m[1]), status: 'planning' }))
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    organize.setFromPath('2024/08/croacia')
    await organize.createPlan()

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/v1/jobs')!
    // sin opciones tocadas, el body OMITE transfer_mode/duplicate_strategy:
    // los defaults los aplica el server y el JobRead creado los ecoa
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ dest_path: '2024/08/croacia' })
    expect(organize.currentJobId).toBe(7)
    // sin WS en el test, la respuesta HTTP alimenta el job vivo
    expect(jobs.activeJob?.id).toBe(7)
    expect(organize.stage).toBe('plan')
  })

  it('loads the plan items (limit-capped) when the tracked job reaches planned', async () => {
    const items = [{ id: 1 }, { id: 2 }]
    vi.stubGlobal('fetch', defaultFetchMock({ '/items': items }))

    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    jobs.activeJob = makeJob({ status: 'planned', total: 2 })
    await vi.waitFor(() => {
      expect(organize.planItems).toHaveLength(2)
    })
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/jobs/7/items?limit=2000', expect.anything())
  })

  it('changing options over a planned job re-plans (new POST /jobs with the new options)', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/jobs' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        return jsonResponse(makeJob({ id: 8, status: 'planning', ...body }), 202)
      }
      if (url.includes('/items')) return jsonResponse([])
      // re-fetch REST anti-cuelgue del job nuevo (vuelve del POST en planning)
      const m = /\/jobs\/(\d+)$/.exec(url)
      if (m) return jsonResponse(makeJob({ id: Number(m[1]), status: 'planning' }))
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    jobs.activeJob = makeJob({ status: 'planned' })
    await nextTick()
    expect(organize.currentJobId).toBe(7)

    await organize.updateOptions({ transfer_mode: 'copy' })

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/v1/jobs')!
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      dest_path: '2024/08/croacia',
      transfer_mode: 'copy',
    })
    // el job seguido ahora es el nuevo (el backend descarta el 7 solo)
    expect(organize.currentJobId).toBe(8)
  })

  it('queues a re-plan when options change while the plan is in flight (planning), firing on planned with the latest options', async () => {
    let nextId = 8
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/jobs' && init?.method === 'POST') {
        const body = JSON.parse(init.body as string)
        return jsonResponse(makeJob({ id: nextId++, status: 'planning', ...body }), 202)
      }
      if (url.includes('/items')) return jsonResponse([])
      const m = /\/jobs\/(\d+)$/.exec(url)
      if (m) return jsonResponse(makeJob({ id: Number(m[1]), status: 'planning' }))
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    // job 7 vivo en planning (el POST resolvió, pero aún NO llegó planned)
    jobs.activeJob = makeJob({ id: 7, status: 'planning' })
    await nextTick()
    expect(organize.currentJobId).toBe(7)

    // opciones cambiadas con el plan en vuelo: se ENCOLA, sin POST todavía
    // (crear otro con el 7 en planning daría 409 job_already_active)
    await organize.updateOptions({ transfer_mode: 'copy' })
    const postsWhilePlanning = fetchMock.mock.calls.filter(
      ([u, i]) => u === '/api/v1/jobs' && (i as RequestInit | undefined)?.method === 'POST',
    )
    expect(postsWhilePlanning).toHaveLength(0)
    expect(organize.currentJobId).toBe(7)

    // el job 7 aterriza en planned (WS) → dispara el re-plan encolado con las
    // últimas opciones; el job ejecutado será el nuevo (8), no el 7 obsoleto
    jobs.activeJob!.status = 'planned'
    await vi.waitFor(() => {
      expect(organize.currentJobId).toBe(8)
    })
    const post = fetchMock.mock.calls.find(
      ([u, i]) => u === '/api/v1/jobs' && (i as RequestInit | undefined)?.method === 'POST',
    )!
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({
      dest_path: '2024/08/croacia',
      transfer_mode: 'copy',
    })
  })

  it('createPlan re-fetches over REST when the POST returns still planning (dropped planned broadcast) so the stage cannot hang', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/jobs' && init?.method === 'POST') {
        return jsonResponse(makeJob({ status: 'planning' }), 202)
      }
      // el broadcast planned se perdió: la DB YA tiene planned (el planner
      // commitea antes de emitir) y la relectura REST lo descubre
      const m = /\/jobs\/(\d+)$/.exec(url)
      if (m) return jsonResponse(makeJob({ id: Number(m[1]), status: 'planned', total: 3 }))
      if (url.includes('/items')) return jsonResponse([])
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const organize = useOrganizeStore()
    organize.setFromPath('2024/08/croacia')
    await organize.createPlan()

    // sin el rescate REST el job quedaría clavado en planning y el spinner de
    // la etapa plan giraría sin fin
    await vi.waitFor(() => {
      expect(organize.currentJob?.status).toBe('planned')
    })
    expect(organize.stage).toBe('plan')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/jobs/7', expect.anything())
  })

  it('409 job_already_active → toast + adopts the live job fetched over REST', async () => {
    const live = makeJob({ id: 9, status: 'running', dest_path: '2025/roma' })
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/jobs' && init?.method === 'POST') {
        return jsonResponse({ detail: 'job_already_active' }, 409)
      }
      if (url === '/api/v1/jobs') return jsonResponse([live])
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    const toast = useToastStore()
    organize.setFromPath('2024/08/croacia')
    await organize.createPlan()
    await nextTick()

    expect(toast.toasts).toHaveLength(1)
    expect(toast.toasts[0].kind).toBe('error')
    // el job vivo recuperado por REST queda aplicado y adoptado
    expect(jobs.activeJob?.id).toBe(9)
    expect(organize.currentJobId).toBe(9)
    expect(organize.stage).toBe('running')
  })

  it('execute promotes the tracked job to running; cancel POSTs the cooperative cancel', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/execute') && init?.method === 'POST') {
        return jsonResponse(makeJob({ status: 'running', started_at: '2026-08-13T10:01:00Z' }), 202)
      }
      if (url.endsWith('/cancel') && init?.method === 'POST') {
        return jsonResponse(makeJob({ status: 'running' }), 202)
      }
      if (url.includes('/items')) return jsonResponse([])
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    jobs.activeJob = makeJob({ status: 'planned' })
    await nextTick()

    await organize.execute()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/jobs/7/execute', expect.objectContaining({ method: 'POST' }))
    expect(organize.stage).toBe('running')

    await organize.cancel()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/jobs/7/cancel', expect.objectContaining({ method: 'POST' }))
    // cooperativa: el estado no cambia hasta el job-status del WS
    expect(organize.stage).toBe('running')
  })

  it('an HTTP response never regresses the status the WS already advanced', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/jobs' && init?.method === 'POST') {
        // respuesta LENTA del POST: llega con status planning…
        return jsonResponse(makeJob({ status: 'planning' }), 202)
      }
      if (url.includes('/items')) return jsonResponse([])
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    organize.setFromPath('2024/08/croacia')
    // …pero el WS ya había adelantado el job a planned
    jobs.activeJob = makeJob({ status: 'planned' })
    await nextTick()
    await organize.createPlan()

    expect(jobs.activeJob?.status).toBe('planned')
  })

  it('backToCompose stops tracking the plan and does NOT re-adopt the dismissed job', async () => {
    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    jobs.activeJob = makeJob({ status: 'planned' })
    await nextTick()
    expect(organize.stage).toBe('plan')

    organize.backToCompose()
    expect(organize.stage).toBe('compose')
    // los segmentos NO se pierden (volver es para editarlos)
    expect(organize.destSegments).toEqual(['2024', '08', 'croacia'])

    // una mutación posterior del job vivo no lo re-adopta
    jobs.activeJob!.total = 5
    await nextTick()
    expect(organize.currentJobId).toBeNull()
    expect(organize.stage).toBe('compose')
  })

  it('stamps a late immich event (post-terminal) onto the tracked snapshot', async () => {
    vi.stubGlobal(
      'fetch',
      defaultFetchMock({ '/jobs/7': makeJob({ status: 'completed', immich_status: null }) }),
    )
    const organize = useOrganizeStore()
    const jobs = useJobsStore()
    jobs.activeJob = makeJob({ status: 'running' })
    await nextTick()
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 7, status: 'completed' } })
    await vi.waitFor(() => {
      expect(organize.currentJob?.status).toBe('completed')
    })
    expect(organize.currentJob?.immich_status).toBeNull()

    // el evento immich llega DESPUÉS del terminal (activeJob ya es null)
    jobs.applyWsMessage({ type: 'immich', data: { job_id: 7, status: 'ok' } })
    await nextTick()
    expect(organize.currentJob?.immich_status).toBe('ok')
  })
})
