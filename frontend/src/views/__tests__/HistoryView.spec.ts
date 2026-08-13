import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import HistoryView from '@/views/HistoryView.vue'
import { fetchJobs } from '@/api/jobs'
import { createI18nInstance } from '@/i18n'
import { router } from '@/router'
import { useJobsStore } from '@/stores/jobs'
import type { JobRead } from '@/types/api'

vi.mock('@/api/jobs', () => ({
  fetchJobs: vi.fn(),
  fetchJob: vi.fn(),
  fetchJobItems: vi.fn(),
}))

const mockedFetchJobs = vi.mocked(fetchJobs)

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

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push({ name: 'history' })
  await router.isReady()
  const wrapper = mount(HistoryView, {
    global: { plugins: [pinia, router, createI18nInstance()] },
  })
  await flushPromises()
  return { wrapper, jobs: useJobsStore() }
}

describe('HistoryView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the history on mount and shows the empty state with a CTA to /organize', async () => {
    mockedFetchJobs.mockResolvedValue([])
    const { wrapper } = await mountView()
    expect(mockedFetchJobs).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Aún no hay trabajos')

    await wrapper.get('[data-testid="history-empty-action"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('organize')
  })

  it('renders one JobCard per job in server order (newest first)', async () => {
    mockedFetchJobs.mockResolvedValue([
      makeJob({ id: 9, dest_path: '2025/02/ultimo' }),
      makeJob({ id: 7, dest_path: '2024/08/croacia' }),
    ])
    const { wrapper } = await mountView()
    const cards = wrapper.findAll('[data-testid="job-card"]')
    expect(cards).toHaveLength(2)
    expect(cards[0].text()).toContain('2025/02/ultimo')
    expect(cards[1].text()).toContain('2024/08/croacia')
  })

  it('shows the active-job banner when jobs.activeJob is set and it links to /organize', async () => {
    mockedFetchJobs.mockResolvedValue([])
    const { wrapper, jobs } = await mountView()
    expect(wrapper.find('[data-testid="history-active-banner"]').exists()).toBe(false)

    jobs.activeJob = makeJob({ status: 'running', finished_at: null })
    await nextTick()
    const banner = wrapper.get('[data-testid="history-active-banner"]')
    expect(banner.text()).toContain('Hay un trabajo en curso')

    await banner.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('organize')
  })

  it('re-fetches on the refresh button', async () => {
    mockedFetchJobs.mockResolvedValue([makeJob()])
    const { wrapper } = await mountView()
    expect(mockedFetchJobs).toHaveBeenCalledTimes(1)

    await wrapper.get('[data-testid="history-refresh"]').trigger('click')
    await flushPromises()
    expect(mockedFetchJobs).toHaveBeenCalledTimes(2)
  })

  it('shows the load-failure empty state with a retry that recovers', async () => {
    mockedFetchJobs
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([makeJob()])
    const { wrapper } = await mountView()
    expect(wrapper.text()).toContain('No se pudo cargar el historial.')

    await wrapper.get('[data-testid="history-empty-action"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-testid="job-card"]')).toHaveLength(1)
  })
})
