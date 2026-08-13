import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DestinationBuilder from '../DestinationBuilder.vue'
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

function mountBuilder() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const organize = useOrganizeStore()
  const wrapper = mount(DestinationBuilder, {
    global: { plugins: [pinia, createI18nInstance()] },
    attachTo: document.body,
  })
  return { wrapper, organize }
}

describe('DestinationBuilder', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/output/dirs')) return jsonResponse(DIRS)
        return jsonResponse([])
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  // ---- composición de segmentos (equivalentes al builder previo) ----

  it('Enter commits the typed segment as a chip and clears the field', async () => {
    const { wrapper, organize } = mountBuilder()
    const input = wrapper.get('input')
    await input.setValue('croacia')
    await input.trigger('keydown', { key: 'Enter' })

    expect(organize.destSegments).toEqual(['croacia'])
    const chips = wrapper.findAll('[data-testid="dest-chip"]')
    expect(chips).toHaveLength(1)
    expect(chips[0].text()).toContain('croacia')
    expect((input.element as HTMLInputElement).value).toBe('')
    // la preview refleja lo confirmado, RELATIVA a output (sin prefijo)
    const preview = wrapper.get('[data-testid="dest-preview"]').text()
    expect(preview).toContain('croacia/')
    expect(preview).not.toContain('/output')
  })

  it('typing / commits the pending segment (chaining), and an unmatched value commits too', async () => {
    const { wrapper, organize } = mountBuilder()
    const input = wrapper.get('input')
    // "carpeta-nueva" no existe en /output/dirs: se confirma igual — crear
    // carpeta nueva ES el caso de uso
    await input.setValue('carpeta-nueva/')
    expect(organize.destSegments).toEqual(['carpeta-nueva'])
    expect((input.element as HTMLInputElement).value).toBe('')

    await input.setValue('2024/08')
    expect(organize.destSegments).toEqual(['carpeta-nueva', '2024'])
    expect((input.element as HTMLInputElement).value).toBe('08')
  })

  it('rejects invalid segments with an inline error, keeping what was typed', async () => {
    const { wrapper, organize } = mountBuilder()
    const input = wrapper.get('input')
    await input.setValue('mal:nombre')
    await input.trigger('keydown', { key: 'Enter' })

    expect(organize.destSegments).toEqual([])
    expect((input.element as HTMLInputElement).value).toBe('mal:nombre')
    expect(wrapper.text()).toContain('Nombre de carpeta no válido.')
  })

  it('chips remove their own segment; the .. button and backspace-on-empty remove the last', async () => {
    const { wrapper, organize } = mountBuilder()
    organize.setFromPath('2024/08/croacia')
    await nextTick()

    // tap en el chip del medio: quita ESE segmento
    await wrapper.findAll('[data-testid="dest-chip"]')[1].trigger('click')
    expect(organize.destSegments).toEqual(['2024', 'croacia'])

    await wrapper.get('[data-testid="dest-up"]').trigger('click')
    expect(organize.destSegments).toEqual(['2024'])

    await wrapper.get('input').trigger('keydown', { key: 'Backspace' })
    expect(organize.destSegments).toEqual([])
    expect(wrapper.find('[data-testid="dest-up"]').exists()).toBe(false)
  })

  // ---- breadcrumb "estás aquí" ----

  it('shows a root affordance (no /output literal) and jumps back to top on click', async () => {
    const { wrapper, organize } = mountBuilder()
    organize.setFromPath('2025/08')
    await nextTick()
    const root = wrapper.get('[data-testid="dest-root"]')
    // la raíz es un icono clicable, sin el texto informativo "/output"
    expect(root.text()).not.toContain('/output')
    await root.trigger('click')
    expect(organize.destSegments).toEqual([])
    // sin segmentos confirmados no hay chips ni `..`
    expect(wrapper.findAll('[data-testid="dest-chip"]')).toHaveLength(0)
    expect(wrapper.find('[data-testid="dest-up"]').exists()).toBe(false)
  })

  // ---- carga del árbol de salida ----

  it('debounces the dirs fetch (300ms) and collapses a burst of path changes into one request', async () => {
    vi.useFakeTimers()
    const { organize } = mountBuilder()
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>

    // el watcher immediate programa el primer fetch; aún no ha disparado
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchMock).not.toHaveBeenCalled()

    // cambio de ruta antes de vencer el debounce: se REPROGRAMA (el timer
    // viejo muere) — a los 350ms del arranque sigue sin haber fetch
    organize.addSegment('2024')
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    expect(fetchMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/output/dirs?path=2024', expect.anything())
  })

  it('renders the fetched folder list, visible without focusing the input', async () => {
    vi.useFakeTimers()
    const { wrapper } = mountBuilder()
    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    // el árbol se ve SIN tocar el input (no está tras el foco)
    expect(wrapper.find('[data-testid="dest-tree"]').exists()).toBe(true)
    const folders = wrapper.findAll('[data-testid="dest-folder"]')
    expect(folders).toHaveLength(3)
    expect(folders.map((f) => f.text())).toEqual(['2024', '2025', 'viajes'])
    // has_children pinta la afordancia de "entra"; una hoja no
    expect(folders[0].find('[data-testid="dest-folder-more"]').exists()).toBe(true)
    expect(folders[1].find('[data-testid="dest-folder-more"]').exists()).toBe(false)
  })

  it('tapping a folder descends into it and reloads the list for the new level', async () => {
    vi.useFakeTimers()
    const { wrapper, organize } = mountBuilder()
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    await vi.advanceTimersByTimeAsync(300)
    await nextTick()

    await wrapper.findAll('[data-testid="dest-folder"]')[0].trigger('click')
    expect(organize.destSegments).toEqual(['2024'])

    // descender recarga la lista al nivel nuevo
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/output/dirs?path=2024', expect.anything())
  })

  it('removing a breadcrumb chip reloads the parent level', async () => {
    vi.useFakeTimers()
    const { wrapper, organize } = mountBuilder()
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    organize.setFromPath('2024/08')
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    fetchMock.mockClear()

    // `..` sube un nivel: la lista recarga la ruta padre
    await wrapper.get('[data-testid="dest-up"]').trigger('click')
    expect(organize.destSegments).toEqual(['2024'])
    await vi.advanceTimersByTimeAsync(300)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/output/dirs?path=2024', expect.anything())
  })
})
