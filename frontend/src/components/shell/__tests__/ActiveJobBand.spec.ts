import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import ActiveJobBand from '../ActiveJobBand.vue'
import { createI18nInstance } from '@/i18n'
import { router } from '@/router'
import { useJobsStore } from '@/stores/jobs'
import type { JobRead } from '@/types/api'

function makeJob(over: Partial<JobRead> = {}): JobRead {
  return {
    id: 7,
    status: 'running',
    dest_path: '2024/08/croacia',
    transfer_mode: 'move',
    duplicate_strategy: 'rename',
    total: 40,
    done: 12,
    errors: 0,
    skipped: 1,
    error: null,
    immich_status: null,
    created_at: '2026-08-13T10:00:00Z',
    started_at: '2026-08-13T10:01:00Z',
    finished_at: null,
    ...over,
  }
}

async function mountBand() {
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push({ name: 'history' })
  await router.isReady()
  const wrapper = mount(ActiveJobBand, {
    global: { plugins: [pinia, router, createI18nInstance()] },
  })
  return { wrapper, jobs: useJobsStore() }
}

describe('ActiveJobBand', () => {
  it('stays hidden without an active job', async () => {
    const { wrapper } = await mountBand()
    expect(wrapper.find('[data-testid="active-job-band"]').exists()).toBe(false)
  })

  it('shows execution counters for a running job and navigates to /organize on tap', async () => {
    const { wrapper, jobs } = await mountBand()
    jobs.activeJob = makeJob()
    await nextTick()

    const band = wrapper.get('[data-testid="active-job-band"]')
    expect(band.text()).toBe('Organizando · 12/40')

    await band.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('organize')
  })

  it('during planning shows plan-progress (or the idle label before the first tick)', async () => {
    const { wrapper, jobs } = await mountBand()
    jobs.activeJob = makeJob({ status: 'planning', done: 0, skipped: 0, total: 0 })
    await nextTick()
    expect(wrapper.get('[data-testid="active-job-band"]').text()).toBe('Preparando…')

    jobs.planProgress = { scanned: 42, total: 120 }
    await nextTick()
    expect(wrapper.get('[data-testid="active-job-band"]').text()).toBe('Preparando · 42/120')
  })
})
