import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import App from '@/App.vue'
import { createI18nInstance } from '@/i18n'
import { router } from '@/router'
import { useJobsStore } from '@/stores/jobs'
import { useUploadsStore } from '@/stores/uploads'
import type { JobRead } from '@/types/api'

async function mountApp() {
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push('/')
  await router.isReady()
  const wrapper = mount(App, {
    global: { plugins: [pinia, router, createI18nInstance()] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

const runningJob: JobRead = {
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
}

describe('ShellView', () => {
  beforeEach(async () => {
    await router.push('/')
    await router.isReady()
  })

  it('redirects / to /organize and renders the 4-section bottom nav with the upload CTA slab', async () => {
    const wrapper = await mountApp()
    expect(router.currentRoute.value.name).toBe('organize')

    const mobileNav = wrapper.findAll('nav').at(-1)!
    expect(mobileNav.findAll('li')).toHaveLength(4)
    expect(wrapper.find('[data-testid="cta-slab-mobile"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="cta-slab"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nav-indicator"]').exists()).toBe(true)
  })

  it('slides the mobile indicator by whole columns when the section changes', async () => {
    const wrapper = await mountApp()
    const indicator = wrapper.get('[data-testid="nav-indicator"]')
    expect(indicator.attributes('style')).toContain('translateX(0%)')

    await router.push({ name: 'settings' })
    await nextTick()
    expect(indicator.attributes('style')).toContain('translateX(300%)')
  })

  it('shows n/total in the CTA slab while uploads are active (uploads store contract)', async () => {
    const wrapper = await mountApp()
    expect(wrapper.find('[data-testid="cta-uploads-mobile"]').exists()).toBe(false)

    const uploads = useUploadsStore()
    uploads.active = true
    uploads.done = 3
    uploads.total = 12
    await nextTick()

    expect(wrapper.get('[data-testid="cta-uploads-mobile"]').text()).toBe('3/12')
    const glow = wrapper.findAll('[data-testid="upload-glow"]').at(-1)!
    expect(glow.attributes('style')).toContain('opacity: 0.5')
  })

  it('shows the active-job band while a job runs and taps through to /organize (jobs store contract)', async () => {
    const wrapper = await mountApp()
    expect(wrapper.find('[data-testid="active-job-band"]').exists()).toBe(false)

    const jobs = useJobsStore()
    jobs.activeJob = runningJob
    await nextTick()

    const band = wrapper.get('[data-testid="active-job-band"]')
    expect(band.text()).toContain('12/40')

    await router.push({ name: 'history' })
    await band.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('organize')
  })

  it('renders stub views with their i18n title on every section', async () => {
    const wrapper = await mountApp()
    for (const [name, title] of [
      ['organize', 'Organizar'],
      ['upload', 'Subir'],
      ['history', 'Historial'],
      ['settings', 'Ajustes'],
    ] as const) {
      await router.push({ name })
      await flushPromises()
      expect(wrapper.get('main h1').text()).toBe(title)
    }
  })
})
