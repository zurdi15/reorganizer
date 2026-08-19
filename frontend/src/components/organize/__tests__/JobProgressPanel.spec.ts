import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import JobProgressPanel from '../JobProgressPanel.vue'
import { createI18nInstance } from '@/i18n'
import { router } from '@/router'
import { useJobsStore } from '@/stores/jobs'
import { useOrganizeStore } from '@/stores/organize'
import type { JobRead, WsItemDone } from '@/types/api'

function makeJob(over: Partial<JobRead> = {}): JobRead {
  return {
    id: 7,
    status: 'running',
    dest_path: '2024/08/croacia',
    transfer_mode: 'move',
    duplicate_strategy: 'rename',
    total: 40,
    done: 12,
    errors: 1,
    skipped: 2,
    error: null,
    immich_status: null,
    created_at: '2026-08-13T10:00:00Z',
    started_at: '2026-08-13T10:01:00Z',
    finished_at: null,
    ...over,
  }
}

function makeItemDone(over: Partial<WsItemDone['data']> = {}): WsItemDone {
  return {
    type: 'item-done',
    data: {
      job_id: 7,
      item_id: 1,
      source_path: 'IMG_1.jpg',
      media_type: 'photo',
      orientation: null,
      status: 'done',
      dest: '2024/08/croacia/photo/IMG_1.jpg',
      error: null,
      counters: { done: 13, errors: 1, skipped: 2, total: 40 },
      ...over,
    },
  }
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

let finalJob: JobRead

async function mountPanel(job: JobRead = makeJob()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const organize = useOrganizeStore()
  const jobs = useJobsStore()
  jobs.activeJob = job
  await nextTick()
  await router.push({ name: 'organize' })
  await router.isReady()
  const wrapper = mount(JobProgressPanel, {
    global: { plugins: [pinia, router, createI18nInstance()] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, organize, jobs }
}

describe('JobProgressPanel', () => {
  beforeEach(() => {
    finalJob = makeJob({ status: 'completed', done: 37, finished_at: '2026-08-13T10:30:00Z' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (/\/jobs\/7$/.test(url)) return jsonResponse(finalJob)
        if (url.includes('/items')) return jsonResponse([])
        return jsonResponse([])
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('running: live counters from the store, progress bar and mono processed line', async () => {
    const { wrapper, jobs } = await mountPanel()

    expect(wrapper.get('[data-testid="job-processed"]').text()).toBe('15/40')
    expect(wrapper.get('[data-testid="counter-ok"]').text()).toBe('12 ok')
    expect(wrapper.get('[data-testid="counter-errors"]').text()).toBe('1 error')
    expect(wrapper.get('[data-testid="counter-skipped"]').text()).toBe('2 saltados')

    // un item-done por WS mueve los contadores en vivo
    jobs.applyWsMessage(makeItemDone())
    await nextTick()
    expect(wrapper.get('[data-testid="counter-ok"]').text()).toBe('13 ok')
    expect(wrapper.get('[data-testid="job-processed"]').text()).toBe('16/40')
  })

  it('the log renders ring events as PLAIN TEXT (hostile filenames stay inert), errors in danger', async () => {
    const { wrapper, jobs } = await mountPanel()
    const hostile = '<img src=x onerror=alert(1)>.jpg'
    jobs.applyWsMessage(makeItemDone({ item_id: 1, source_path: hostile }))
    jobs.applyWsMessage(
      makeItemDone({ item_id: 2, source_path: 'MAL.jpg', status: 'error', dest: null, error: 'invalid_path' }),
    )
    await nextTick()

    const lines = wrapper.findAll('[data-testid="job-log"] li')
    expect(lines).toHaveLength(2)
    // más recientes primero
    expect(lines[0].text()).toContain('MAL.jpg')
    expect(lines[0].classes()).toContain('text-danger')
    expect(lines[1].text()).toContain(hostile)
    // el nombre JAMÁS se interpreta como HTML
    expect(document.querySelector('img[src="x"]')).toBeNull()
  })

  it('cancel POSTs the cooperative cancel', async () => {
    const { wrapper } = await mountPanel()
    await wrapper.get('[data-testid="job-cancel"]').trigger('click')
    await flushPromises()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/v1/jobs/7/cancel',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('done: final summary per status; Immich chip spins until the event lands', async () => {
    const { wrapper, jobs, organize } = await mountPanel()

    // terminal por WS → etapa done + fetch del estado final (immich aún null)
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 7, status: 'completed' } })
    await vi.waitFor(() => {
      expect(organize.currentJob?.status).toBe('completed')
    })
    await nextTick()

    expect(wrapper.get('[data-testid="job-result"]').text()).toBe('Completado')
    expect(wrapper.get('[data-testid="job-summary"]').text()).toContain('37 archivos organizados')
    expect(wrapper.find('[data-testid="immich-pending"]').exists()).toBe(true)

    // llega el evento immich (post-terminal): el chip cambia en vivo
    jobs.applyWsMessage({ type: 'immich', data: { job_id: 7, status: 'ok' } })
    await nextTick()
    expect(wrapper.find('[data-testid="immich-pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="immich-ok"]').exists()).toBe(true)
  })

  it('done: immich skipped links to settings; "Organizar más" resets to compose', async () => {
    finalJob = makeJob({ status: 'completed', immich_status: 'skipped', finished_at: '2026-08-13T10:30:00Z' })
    const { wrapper, jobs, organize } = await mountPanel()
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 7, status: 'completed' } })
    await vi.waitFor(() => {
      expect(organize.currentJob?.immich_status).toBe('skipped')
    })
    await nextTick()

    await wrapper.get('[data-testid="immich-skipped"]').trigger('click')
    // /settings carga perezosa: la navegación acaba cuando resuelve su chunk
    await vi.waitFor(
      () => {
        expect(router.currentRoute.value.name).toBe('settings')
      },
      // el chunk de la vista se transforma la primera vez: 1s se queda corto
      { timeout: 5000 },
    )

    await wrapper.get('[data-testid="job-organize-more"]').trigger('click')
    expect(organize.stage).toBe('compose')
  })

  it('done: a cancelled job shows its own final state', async () => {
    finalJob = makeJob({ status: 'cancelled', finished_at: '2026-08-13T10:30:00Z' })
    const { wrapper, jobs, organize } = await mountPanel()
    jobs.applyWsMessage({ type: 'job-status', data: { job_id: 7, status: 'cancelled' } })
    await vi.waitFor(() => {
      expect(organize.currentJob?.status).toBe('cancelled')
    })
    await nextTick()

    expect(wrapper.get('[data-testid="job-result"]').text()).toBe('Cancelado')
    // sin chip immich: el rescan solo se dispara al completar
    expect(wrapper.find('[data-testid="immich-chip"]').exists()).toBe(false)
  })
})
