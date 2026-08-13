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

  it('redirects / to /organize and renders both the desktop rail and the mobile bottom nav with 4 items each', async () => {
    const wrapper = await mountApp()
    expect(router.currentRoute.value.name).toBe('organize')

    const rail = wrapper.get('[data-testid="rail-nav"]')
    const bottom = wrapper.get('[data-testid="bottom-nav"]')
    expect(rail.findAll('a')).toHaveLength(4)
    expect(bottom.findAll('a')).toHaveLength(4)

    // firmas de berserk retiradas: sin slab CTA, sin glow, sin indicadores
    expect(wrapper.find('[data-testid="cta-slab"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="cta-slab-mobile"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="upload-glow"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nav-indicator"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nav-indicator-desktop"]').exists()).toBe(false)
  })

  it('marks the active rail row with aria-current + amber active class, and moves it when the section changes', async () => {
    const wrapper = await mountApp()
    const rail = wrapper.get('[data-testid="rail-nav"]')

    // en /organize el enlace activo es el primero (índice 0)
    const activeOrganize = rail.get('a[aria-current="page"]')
    expect(activeOrganize.text()).toContain('Organizar')
    expect(activeOrganize.classes()).toContain('text-amber')
    expect(rail.findAll('a[aria-current="page"]')).toHaveLength(1)

    await router.push({ name: 'settings' })
    await nextTick()
    const activeSettings = rail.get('a[aria-current="page"]')
    expect(activeSettings.text()).toContain('Ajustes')
    expect(rail.findAll('a[aria-current="page"]')).toHaveLength(1)
  })

  it('puts the amber pill behind the active icon in the mobile bottom nav on the current route', async () => {
    const wrapper = await mountApp()
    const bottom = wrapper.get('[data-testid="bottom-nav"]')

    const activeLink = bottom.get('a[aria-current="page"]')
    expect(activeLink.text()).toContain('Organizar')
    expect(activeLink.get('[data-testid="bottom-nav-pill"]').classes()).toContain('bg-amber/15')

    await router.push({ name: 'history' })
    await nextTick()
    const nowActive = bottom.get('a[aria-current="page"]')
    expect(nowActive.text()).toContain('Historial')
    expect(nowActive.get('[data-testid="bottom-nav-pill"]').classes()).toContain('bg-amber/15')
  })

  it('shows the uploads badge on the Upload item (rail n/total + mobile dot) while uploads are active (uploads store contract)', async () => {
    const wrapper = await mountApp()
    expect(wrapper.find('[data-testid="upload-badge-rail"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="upload-badge-mobile"]').exists()).toBe(false)

    const uploads = useUploadsStore()
    uploads.active = true
    uploads.done = 3
    uploads.total = 12
    await nextTick()

    expect(wrapper.get('[data-testid="upload-badge-rail"]').text()).toBe('3/12')
    expect(wrapper.find('[data-testid="upload-badge-mobile"]').exists()).toBe(true)
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
