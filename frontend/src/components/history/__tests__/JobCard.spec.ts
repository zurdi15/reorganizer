import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import JobCard from '../JobCard.vue'
import { fetchJobItems } from '@/api/jobs'
import { createI18nInstance } from '@/i18n'
import { router } from '@/router'
import type { JobItem, JobRead } from '@/types/api'

vi.mock('@/api/jobs', () => ({
  fetchJobs: vi.fn(),
  fetchJob: vi.fn(),
  fetchJobItems: vi.fn(),
}))

const mockedFetchJobItems = vi.mocked(fetchJobItems)

function makeJob(over: Partial<JobRead> = {}): JobRead {
  return {
    id: 7,
    status: 'completed',
    dest_path: '2024/08/croacia',
    transfer_mode: 'move',
    duplicate_strategy: 'rename',
    total: 40,
    done: 38,
    errors: 0,
    skipped: 2,
    error: null,
    immich_status: null,
    created_at: '2026-08-13T10:00:00Z',
    started_at: '2026-08-13T10:00:05Z',
    finished_at: '2026-08-13T10:05:00Z',
    ...over,
  }
}

function makeItem(over: Partial<JobItem> = {}): JobItem {
  return {
    id: 1,
    job_id: 7,
    source_path: 'IMG_0001.jpg',
    size_bytes: 1024,
    media_type: 'photo',
    orientation: null,
    taken_at: null,
    camera_make: null,
    camera_model: null,
    matched_rule_id: null,
    planned_dest: '2024/08/croacia/photo/IMG_0001.jpg',
    final_dest: '2024/08/croacia/photo/IMG_0001.jpg',
    status: 'done',
    error: null,
    content_hash: null,
    collision: null,
    ...over,
  }
}

async function mountCard(job: JobRead) {
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push({ name: 'history' })
  await router.isReady()
  return mount(JobCard, {
    props: { job },
    global: { plugins: [pinia, router, createI18nInstance()] },
  })
}

describe('JobCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetchJobItems.mockResolvedValue([])
  })

  it('maps every job status to its pill (matrix)', async () => {
    const cases = [
      ['completed', 'Completado'],
      ['completed_with_errors', 'Con errores'],
      ['cancelled', 'Cancelado'],
      ['interrupted', 'Interrumpido'],
      ['discarded', 'Descartado'],
      ['failed', 'Fallido'],
      ['planning', 'En curso'],
      ['planned', 'En curso'],
      ['running', 'En curso'],
    ] as const
    for (const [status, label] of cases) {
      const wrapper = await mountCard(makeJob({ status }))
      expect(wrapper.get('[data-testid="job-status-pill"]').text()).toBe(label)
      wrapper.unmount()
    }
  })

  it('shows the transfer-mode tag and the dest path as plain text with the full path in the title', async () => {
    const wrapper = await mountCard(makeJob({ transfer_mode: 'copy' }))
    expect(wrapper.get('[data-testid="job-mode"]').text()).toBe('Copiado')
    const dest = wrapper.get('[data-testid="job-dest"]')
    expect(dest.text()).toBe('2024/08/croacia')
    expect(dest.attributes('title')).toBe('2024/08/croacia')
  })

  it('renders the relative date with the absolute one in the title attribute', async () => {
    const wrapper = await mountCard(makeJob())
    const date = wrapper.get('[data-testid="job-date"]')
    expect(date.text().length).toBeGreaterThan(0)
    expect(date.attributes('title')).toContain('2026')
  })

  it('shows the done counter always and hides zero errors/skipped', async () => {
    const wrapper = await mountCard(makeJob({ total: 5, done: 5, errors: 0, skipped: 0 }))
    expect(wrapper.get('[data-testid="job-counter-done"]').text()).toBe('5 ok')
    expect(wrapper.find('[data-testid="job-counter-errors"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="job-counter-skipped"]').exists()).toBe(false)
  })

  it('shows error/skipped counters when they are non-zero, with plurals', async () => {
    const wrapper = await mountCard(makeJob({ total: 33, done: 30, errors: 2, skipped: 1 }))
    expect(wrapper.get('[data-testid="job-counter-errors"]').text()).toBe('2 errores')
    expect(wrapper.get('[data-testid="job-counter-skipped"]').text()).toBe('1 saltado')
  })

  it('renders the Immich chip variants and hides it when null', async () => {
    const hidden = await mountCard(makeJob({ immich_status: null }))
    expect(hidden.find('[data-testid="job-immich"]').exists()).toBe(false)
    hidden.unmount()

    const cases = [
      ['ok', 'Immich ok'],
      ['failed', 'Immich falló'],
      ['skipped', 'Immich omitido'],
    ] as const
    for (const [status, label] of cases) {
      const wrapper = await mountCard(makeJob({ immich_status: status }))
      expect(wrapper.get('[data-testid="job-immich"]').text()).toBe(label)
      wrapper.unmount()
    }
  })

  it('expands as an inline accordion and fetches items lazily, only once', async () => {
    mockedFetchJobItems.mockResolvedValue([makeItem()])
    const wrapper = await mountCard(makeJob())
    // colapsado: ni fetch ni panel
    expect(mockedFetchJobItems).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="job-items"]').exists()).toBe(false)

    const toggle = wrapper.get('[data-testid="job-card-toggle"]')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    // spinner mientras la primera página está en vuelo
    expect(wrapper.find('[data-testid="job-items-spinner"]').exists()).toBe(true)
    await flushPromises()
    expect(mockedFetchJobItems).toHaveBeenCalledWith(7, { limit: 50, offset: 0 })
    expect(wrapper.get('[data-testid="job-item-row"]').text()).toContain('IMG_0001.jpg')

    // replegar + re-expandir NO vuelve a pedir (acordeón perezoso una vez)
    await toggle.trigger('click')
    await nextTick()
    await toggle.trigger('click')
    await flushPromises()
    expect(mockedFetchJobItems).toHaveBeenCalledTimes(1)
  })

  it('shows the fatal error translated for failed jobs inside the accordion', async () => {
    const wrapper = await mountCard(makeJob({ status: 'failed', error: 'job_failed' }))
    await wrapper.get('[data-testid="job-card-toggle"]').trigger('click')
    await flushPromises()
    // job_failed tiene traducción en errors.* desde la oleada 5
    expect(wrapper.get('[data-testid="job-fatal-error"]').text()).toContain(
      'El trabajo falló de forma inesperada.',
    )
  })

  it('"Repetir con esta ruta" pushes the organize route with the exact dest query contract', async () => {
    const wrapper = await mountCard(makeJob({ status: 'failed', dest_path: '2024/08/croacia' }))
    await wrapper.get('[data-testid="job-card-toggle"]').trigger('click')
    await flushPromises()

    await wrapper.get('[data-testid="job-repeat-btn"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('organize')
    expect(router.currentRoute.value.query).toEqual({ dest: '2024/08/croacia' })
  })
})
