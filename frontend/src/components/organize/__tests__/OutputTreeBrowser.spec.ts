import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import OutputTreeBrowser from '../OutputTreeBrowser.vue'
import { createI18nInstance } from '@/i18n'
import { useOrganizeStore } from '@/stores/organize'
import type { OutputDir } from '@/types/api'

const DIRS: OutputDir[] = [
  { name: '2024', has_children: true },
  { name: '2025', has_children: false },
  { name: 'viajes', has_children: true },
]

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

// permite a cada test decidir qué devuelve /output/dirs
function stubFetch(dirs: OutputDir[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/output/dirs')) return jsonResponse(dirs)
      return jsonResponse([])
    }),
  )
}

function mountBrowser() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const organize = useOrganizeStore()
  const wrapper = mount(OutputTreeBrowser, {
    global: { plugins: [pinia, createI18nInstance()] },
    attachTo: document.body,
  })
  return { wrapper, organize }
}

describe('OutputTreeBrowser', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    stubFetch(DIRS)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('shows a loading spinner until the level resolves, then the folder rows', async () => {
    const { wrapper } = mountBrowser()
    // antes de vencer el debounce: el nivel se anuncia "cargando", sin filas
    expect(wrapper.find('[data-testid="dest-loading"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="dest-folder"]')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    expect(wrapper.find('[data-testid="dest-loading"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-testid="dest-folder"]')).toHaveLength(3)
  })

  it('renders an empty state when the level has no subfolders', async () => {
    stubFetch([])
    const { wrapper } = mountBrowser()
    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    expect(wrapper.find('[data-testid="dest-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-testid="dest-folder"]')).toHaveLength(0)
  })

  it('paints a has_children affordance only on folders with subfolders', async () => {
    const { wrapper } = mountBrowser()
    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    const folders = wrapper.findAll('[data-testid="dest-folder"]')
    // 2024 y viajes tienen hijos; 2025 es hoja
    expect(folders[0].find('[data-testid="dest-folder-more"]').exists()).toBe(true)
    expect(folders[1].find('[data-testid="dest-folder-more"]').exists()).toBe(false)
    expect(folders[2].find('[data-testid="dest-folder-more"]').exists()).toBe(true)
  })

  it('filters the list live while typing (folded) and still commits a new folder', async () => {
    const { wrapper, organize } = mountBrowser()
    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    const input = wrapper.get('input')
    // teclear filtra en cliente: "20" deja 2024 y 2025 (viajes fuera)
    await input.setValue('20')
    await nextTick()
    let folders = wrapper.findAll('[data-testid="dest-folder"]')
    expect(folders.map((f) => f.text())).toEqual(['2024', '2025'])

    // un nombre que no existe: la lista no casa nada pero SÍ se puede crear
    await input.setValue('croacia')
    await nextTick()
    expect(wrapper.find('[data-testid="dest-nomatches"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="dest-create"]').exists()).toBe(true)

    await input.trigger('keydown', { key: 'Enter' })
    expect(organize.destSegments).toEqual(['croacia'])
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('marks a typed name that does not exist as "se creará" and commits it on tap', async () => {
    const { wrapper, organize } = mountBrowser()
    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    const input = wrapper.get('input')
    await input.setValue('boda-2024')
    await nextTick()

    const create = wrapper.get('[data-testid="dest-create"]')
    expect(create.text()).toContain('boda-2024')
    expect(create.text()).toContain('se creará')

    await create.trigger('click')
    expect(organize.destSegments).toEqual(['boda-2024'])
  })

  it('descends into a folder on tap and clears any typed query', async () => {
    const { wrapper, organize } = mountBrowser()
    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    const input = wrapper.get('input')
    await input.setValue('20')
    await nextTick()
    // tap en la carpeta existente 2024: DESCIENDE (no crea)
    await wrapper.findAll('[data-testid="dest-folder"]')[0].trigger('click')

    expect(organize.destSegments).toEqual(['2024'])
    expect((input.element as HTMLInputElement).value).toBe('')
  })

  it('backspace on an empty query removes the last segment (up one level)', async () => {
    const { wrapper, organize } = mountBrowser()
    organize.setFromPath('2024/08')
    await nextTick()

    await wrapper.get('input').trigger('keydown', { key: 'Backspace' })
    expect(organize.destSegments).toEqual(['2024'])
  })
})
