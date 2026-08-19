import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OrganizeView from '../OrganizeView.vue'
import { createI18nInstance } from '@/i18n'
import { router } from '@/router'
import { useInputStore } from '@/stores/input'
import { useJobsStore } from '@/stores/jobs'
import { useOrganizeStore } from '@/stores/organize'
import type { InputFile, JobRead } from '@/types/api'

const FILES: InputFile[] = [
  { path: 'IMG_1.jpg', name: 'IMG_1.jpg', size_bytes: 1024, mtime: 1785535200, kind: 'photo' },
]

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
    skipped: 0,
    error: null,
    immich_status: null,
    created_at: '2026-08-13T10:00:00Z',
    started_at: '2026-08-13T10:01:00Z',
    finished_at: null,
    ...over,
  }
}

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

async function mountView(query: Record<string, string> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  await router.push({ name: 'organize', query })
  await router.isReady()
  const wrapper = mount(OrganizeView, {
    global: { plugins: [pinia, router, createI18nInstance()] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, organize: useOrganizeStore(), input: useInputStore(), jobs: useJobsStore() }
}

describe('OrganizeView', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/v1/jobs' && init?.method === 'POST') {
          return jsonResponse(makeJob({ status: 'planning', total: 0, done: 0 }), 202)
        }
        if (url.includes('/input/files')) return jsonResponse({ files: FILES, total: FILES.length })
        if (url.includes('/input/summary')) return jsonResponse({ photo: 1, video: 0, unknown: 0, total: 1 })
        if (url.includes('/input/dates')) return jsonResponse({ years: [], months_by_year: {} })
        if (url.includes('/items')) return jsonResponse([])
        // re-fetch REST anti-cuelgue (createPlan re-lee el job que vuelve del
        // POST aún en planning por si el broadcast planned se perdió)
        const m = /\/jobs\/(\d+)$/.exec(url)
        if (m) return jsonResponse(makeJob({ id: Number(m[1]), status: 'planning', total: 0, done: 0 }))
        return jsonResponse([])
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('seeds the builder from ?dest= (history contract), drops invalid segments and cleans the URL', async () => {
    const { organize } = await mountView({ dest: '2025/../05 /roma' })

    // '..' cae en la validación; los espacios colgantes se normalizan
    expect(organize.destSegments).toEqual(['2025', '05', 'roma'])
    // la query se limpia con router.replace: un reload no re-siembra
    expect(router.currentRoute.value.query.dest).toBeUndefined()
  })

  it('compose: CTA disabled without segments, enabled with input + dest, and it creates the plan', async () => {
    const { wrapper, organize } = await mountView()

    const cta = wrapper.get('[data-testid="organize-preview-cta"]')
    // hay input (1 archivo) pero no hay segmentos → deshabilitado
    expect((cta.element as HTMLButtonElement).disabled).toBe(true)

    organize.setFromPath('2024/08/croacia')
    await flushPromises()
    expect((cta.element as HTMLButtonElement).disabled).toBe(false)

    await cta.trigger('click')
    await flushPromises()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/v1/jobs',
      expect.objectContaining({ method: 'POST' }),
    )
    // la vista salta a la etapa plan (dry-run en marcha)
    expect(organize.stage).toBe('plan')
    expect(wrapper.find('[data-testid="plan-planning"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="organize-preview-cta"]').exists()).toBe(false)
  })

  it('CTA stays disabled when the input batch is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/input/files')) return jsonResponse({ files: [], total: 0 })
        if (url.includes('/input/summary')) return jsonResponse({ photo: 0, video: 0, unknown: 0, total: 0 })
        if (url.includes('/input/dates')) return jsonResponse({ years: [], months_by_year: {} })
        return jsonResponse([])
      }),
    )
    const { wrapper, organize } = await mountView()
    organize.setFromPath('2024')
    await flushPromises()
    expect((wrapper.get('[data-testid="organize-preview-cta"]').element as HTMLButtonElement).disabled).toBe(true)
  })

  // El problema que resuelve este orden: con miles de archivos sin organizar,
  // la grid crece sin fin (scroll infinito) y todo lo que estuviera debajo
  // quedaba a un scroll interminable, cargando páginas por el camino.
  it('compose: puts the destination card ABOVE the input grid', async () => {
    const { wrapper } = await mountView()

    const html = wrapper.html()
    const destAt = html.indexOf('data-testid="dest-chips"')
    const gridAt = html.indexOf('data-testid="input-count"')
    expect(destAt).toBeGreaterThan(-1)
    expect(gridAt).toBeGreaterThan(-1)
    expect(destAt).toBeLessThan(gridAt)
  })

  it('compose: the sticky bar shows the chosen path and jumps back to the builder', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { wrapper, organize } = await mountView()

    // sin destino: pista en vez de ruta, y el CTA no se puede pulsar
    expect(wrapper.get('[data-testid="compose-bar-empty"]').text()).toBe('Elige un destino')
    expect(wrapper.find('[data-testid="compose-bar-path"]').exists()).toBe(false)

    organize.setFromPath('2024/08/croacia')
    await flushPromises()
    expect(wrapper.get('[data-testid="compose-bar-path"]').text()).toBe('2024/08/croacia/')

    // tocar la ruta trae el compositor a pantalla (puede haber quedado muy
    // arriba tras scrollear la grid)
    await wrapper.get('[data-testid="compose-bar-dest"]').trigger('click')
    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'smooth' }),
    )
  })

  it('the sticky bar belongs to compose only', async () => {
    const { wrapper, organize } = await mountView()
    expect(wrapper.find('[data-testid="compose-bar-dest"]').exists()).toBe(true)

    organize.setFromPath('2024')
    await flushPromises()
    await wrapper.get('[data-testid="organize-preview-cta"]').trigger('click')
    await flushPromises()

    expect(organize.stage).toBe('plan')
    expect(wrapper.find('[data-testid="compose-bar-dest"]').exists()).toBe(false)
  })

  it('lands straight on the right stage when a job is already live on entry (state-sync)', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    // el state-sync llegó ANTES de montar la vista (App-level WS)
    useJobsStore().activeJob = makeJob({ status: 'running' })
    await router.push({ name: 'organize' })
    await router.isReady()
    const wrapper = mount(OrganizeView, {
      global: { plugins: [pinia, router, createI18nInstance()] },
      attachTo: document.body,
    })
    await flushPromises()

    expect(useOrganizeStore().stage).toBe('running')
    expect(wrapper.find('[data-testid="job-running"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="organize-preview-cta"]').exists()).toBe(false)
  })
})
