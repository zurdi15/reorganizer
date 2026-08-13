import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useJobsStore } from '../jobs'
import type { JobRead, WsItemDone, WsMessage } from '@/types/api'

function makeJob(over: Partial<JobRead> = {}): JobRead {
  return {
    id: 7,
    status: 'running',
    dest_path: '2024/08/croacia',
    transfer_mode: 'move',
    duplicate_strategy: 'rename',
    total: 40,
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

function makeItemDone(n: number, jobId = 7): WsItemDone {
  return {
    type: 'item-done',
    data: {
      job_id: jobId,
      item_id: n,
      source_path: `IMG_${n}.jpg`,
      media_type: 'photo',
      orientation: null,
      status: 'done',
      dest: `2024/08/croacia/photo/IMG_${n}.jpg`,
      error: null,
      counters: { done: n, errors: 0, skipped: 0, total: 40 },
    },
  }
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

describe('stores/jobs', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('state-sync restores the active job and replays only log-worthy events into the ring', () => {
    const jobs = useJobsStore()
    const events: WsMessage[] = [
      { type: 'job-status', data: { job_id: 7, status: 'running' } },
      makeItemDone(1),
      { type: 'input-changed', data: { counts: { photo: 1, video: 0, unknown: 0, total: 1 } } },
      { type: 'job-error', data: { job_id: 7, slug: 'input_dir_missing' } },
      { type: 'immich', data: { job_id: 7, status: 'ok' } },
    ]
    jobs.applyWsMessage({
      type: 'state-sync',
      data: { job: makeJob({ done: 12, skipped: 1 }), events },
    })

    expect(jobs.activeJob?.id).toBe(7)
    expect(jobs.activeJob?.done).toBe(12)
    // solo item-done / job-error / immich alimentan el log
    expect(jobs.events.map((e) => e.type)).toEqual(['item-done', 'job-error', 'immich'])
  })

  it('state-sync with a finished job leaves activeJob null (the band contract: only live jobs)', () => {
    const jobs = useJobsStore()
    jobs.applyWsMessage({
      type: 'state-sync',
      data: { job: makeJob({ status: 'completed', finished_at: '2026-08-13T11:00:00Z' }), events: [] },
    })
    expect(jobs.activeJob).toBeNull()

    jobs.applyWsMessage({ type: 'state-sync', data: { job: null, events: [] } })
    expect(jobs.activeJob).toBeNull()
  })

  it('state-sync during planning restores planProgress from the last replayed plan-progress', () => {
    const jobs = useJobsStore()
    jobs.applyWsMessage({
      type: 'state-sync',
      data: {
        job: makeJob({ status: 'planning' }),
        events: [
          { type: 'plan-progress', data: { job_id: 7, scanned: 10, total: 120 } },
          { type: 'plan-progress', data: { job_id: 7, scanned: 42, total: 120 } },
        ],
      },
    })
    expect(jobs.activeJob?.status).toBe('planning')
    expect(jobs.planProgress).toEqual({ scanned: 42, total: 120 })
  })

  it('job-status mutates the live status and clears activeJob on a terminal one', () => {
    const jobs = useJobsStore()
    jobs.applyWsMessage({ type: 'state-sync', data: { job: makeJob({ status: 'planning' }), events: [] } })

    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 7, status: 'running' } })
    expect(jobs.activeJob?.status).toBe('running')

    // otro job_id no toca el activo
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 99, status: 'failed' } })
    expect(jobs.activeJob?.status).toBe('running')

    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 7, status: 'completed' } })
    expect(jobs.activeJob).toBeNull()
    expect(jobs.planProgress).toBeNull()
  })

  it('job-status for an UNKNOWN but still-LIVE job recovers it via GET /jobs/{id} and adopts it', async () => {
    // segunda pestaña/dispositivo: el job arrancó en otro cliente, este no lo
    // conoce (activeJob null). Un job-status vivo debe traerlo por REST.
    const recovered = makeJob({ id: 42, status: 'running' })
    const fetchMock = vi.fn(async () => jsonResponse(recovered))
    vi.stubGlobal('fetch', fetchMock)

    const jobs = useJobsStore()
    expect(jobs.activeJob).toBeNull()

    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 42, status: 'running' } })

    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/jobs/42', expect.anything()),
    )
    await vi.waitFor(() => expect(jobs.activeJob?.id).toBe(42))
    expect(jobs.activeJob?.status).toBe('running')
  })

  it('job-status recovery is deduped: a burst for the same unknown job fires ONE in-flight fetch', async () => {
    // fetch que no resuelve hasta que el test lo ordene: mantiene la
    // recuperación "en vuelo" mientras llegan job-status repetidos
    let resolve!: (r: Response) => void
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const jobs = useJobsStore()
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 42, status: 'planning' } })
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 42, status: 'running' } })
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 42, status: 'running' } })

    // tres job-status del MISMO job desconocido → UN solo GET en vuelo
    expect(fetchMock).toHaveBeenCalledTimes(1)

    resolve(jsonResponse(makeJob({ id: 42, status: 'running' })))
    await vi.waitFor(() => expect(jobs.activeJob?.id).toBe(42))
  })

  it('job-status for an unknown TERMINAL job is ignored (nothing live to adopt, no fetch)', () => {
    const fetchMock = vi.fn(async () => jsonResponse(makeJob()))
    vi.stubGlobal('fetch', fetchMock)

    const jobs = useJobsStore()
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 99, status: 'completed' } })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(jobs.activeJob).toBeNull()
  })

  it('plan-progress only lands on the matching active job', () => {
    const jobs = useJobsStore()
    jobs.applyWsMessage({ type: 'state-sync', data: { job: makeJob({ status: 'planning' }), events: [] } })

    jobs.applyWsMessage({ type: 'plan-progress', data: { job_id: 99, scanned: 5, total: 10 } })
    expect(jobs.planProgress).toBeNull()

    jobs.applyWsMessage({ type: 'plan-progress', data: { job_id: 7, scanned: 5, total: 120 } })
    expect(jobs.planProgress).toEqual({ scanned: 5, total: 120 })
  })

  it('item-done updates the live counters and appends to the ring, which caps at 200', () => {
    const jobs = useJobsStore()
    jobs.applyWsMessage({ type: 'state-sync', data: { job: makeJob(), events: [] } })

    for (let n = 1; n <= 250; n++) jobs.applyWsMessage(makeItemDone(n))

    expect(jobs.activeJob?.done).toBe(250)
    expect(jobs.events).toHaveLength(200)
    // se conservan los ÚLTIMOS 200 (51..250)
    expect((jobs.events[0] as WsItemDone).data.item_id).toBe(51)
    expect((jobs.events[199] as WsItemDone).data.item_id).toBe(250)
  })

  it('immich stamps the status on the matching active job', () => {
    const jobs = useJobsStore()
    jobs.applyWsMessage({ type: 'state-sync', data: { job: makeJob(), events: [] } })
    jobs.applyWsMessage({ type: 'immich', data: { job_id: 7, status: 'failed' } })
    expect(jobs.activeJob?.immich_status).toBe('failed')
    expect(jobs.events.at(-1)?.type).toBe('immich')
  })

  it('loadHistory fetches GET /jobs and lastDestPaths yields the last 3 DISTINCT dest paths', async () => {
    const history = [
      makeJob({ id: 5, status: 'completed', dest_path: '2025/05/roma' }),
      makeJob({ id: 4, status: 'completed', dest_path: '2024/08/croacia' }),
      makeJob({ id: 3, status: 'failed', dest_path: '2025/05/roma' }),
      makeJob({ id: 2, status: 'completed', dest_path: '2023/verano' }),
      makeJob({ id: 1, status: 'completed', dest_path: '2022/otoño' }),
    ]
    const fetchMock = vi.fn(async () => jsonResponse(history))
    vi.stubGlobal('fetch', fetchMock)

    const jobs = useJobsStore()
    await jobs.loadHistory()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/jobs', expect.anything())
    expect(jobs.history).toHaveLength(5)
    // deduplicadas y en orden de recencia
    expect(jobs.lastDestPaths).toEqual(['2025/05/roma', '2024/08/croacia', '2023/verano'])
  })

  it('loadJobItems hits GET /jobs/{id}/items with optional pagination', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const jobs = useJobsStore()
    await jobs.loadJobItems(7)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/jobs/7/items', expect.anything())

    await jobs.loadJobItems(7, { limit: 50, offset: 100 })
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/jobs/7/items?limit=50&offset=100', expect.anything())
  })
})
