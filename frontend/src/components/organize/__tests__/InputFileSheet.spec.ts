import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import InputFileSheet from '../InputFileSheet.vue'
import { createI18nInstance } from '@/i18n'
import { useInputStore } from '@/stores/input'
import type { InputFile, InputProbe } from '@/types/api'

const FILE: InputFile = {
  path: 'sub/DJI_0042.MP4',
  name: 'DJI_0042.MP4',
  size_bytes: 3 * 1024 * 1024,
  // mtime es epoch en SEGUNDOS, no ISO
  mtime: 1785535200,
  kind: 'video',
}

const PROBE: InputProbe = {
  media_type: 'video',
  orientation: 'horizontal',
  taken_at: '2026-07-30T18:21:00Z',
  camera_make: 'DJI',
  camera_model: 'Mini 3',
  // el probe devuelve el OBJETO de la regla ({id,name,dest}), no un id suelto
  matched_rule: { id: 4, name: 'Drones', dest: 'video/horizontal/dron/mini3' },
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

function stubFetch(probe: InputProbe = PROBE) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return { ok: true, status: 204, json: async () => ({}) } as unknown as Response
    if (url.includes('/input/probe')) return jsonResponse(probe)
    if (url.includes('/input/files')) return jsonResponse([])
    if (url.includes('/input/summary')) return jsonResponse({ photo: 0, video: 0, unknown: 0, total: 0 })
    if (url.includes('/input/dates')) return jsonResponse({ years: [], months_by_year: {} })
    throw new Error(`ruta sin mock: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function mountSheet(file: InputFile | null = FILE) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const wrapper = mount(InputFileSheet, {
    props: { file },
    global: { plugins: [pinia, createI18nInstance()] },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

// la sheet teleporta a body: las queries van contra el documento
function q(selector: string): HTMLElement | null {
  return document.querySelector(selector)
}

describe('InputFileSheet', () => {
  beforeEach(() => {
    stubFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('probes the file on open and renders EXIF/camera/rule in the metadata panel', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    await mountSheet()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/input/probe?path=sub%2FDJI_0042.MP4', expect.anything())

    const panel = q('[data-testid="sheet-probe"]') as HTMLElement
    expect(panel.textContent).toContain('DJI Mini 3')
    expect(panel.textContent).toContain('horizontal')
    // la fila de regla muestra nombre + destino del OBJETO matched_rule
    expect(panel.textContent).toContain('Drones → video/horizontal/dron/mini3')
    // preview grande: también thumb=1, nunca el original
    const preview = q('[data-testid="sheet-preview"]') as HTMLImageElement
    expect(preview.getAttribute('src')).toBe('/api/v1/input/preview?path=sub%2FDJI_0042.MP4&thumb=1')
    expect(preview.getAttribute('loading')).toBe('lazy')
  })

  it('shows the _unknown/ fallback when no rule matches', async () => {
    stubFetch({ ...PROBE, matched_rule: null })
    await mountSheet()

    expect(q('[data-testid="sheet-probe"]')?.textContent).toContain('Sin regla → _unknown/')
  })

  it('re-probes when the file prop changes (race-safe reset)', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const wrapper = await mountSheet()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ file: { ...FILE, path: 'otro.jpg', name: 'otro.jpg', kind: 'photo' } })
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/input/probe?path=otro.jpg', expect.anything())
  })

  it('deletes only after the in-sheet confirm step, then refreshes the input store and closes', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    const wrapper = await mountSheet()
    const input = useInputStore()
    input.files = [FILE]

    // primer tap: arma la confirmación, NO borra
    ;(q('[data-testid="sheet-delete"]') as HTMLElement).click()
    await flushPromises()
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)

    // segundo tap: DELETE + refresh + close
    ;(q('[data-testid="sheet-delete-confirm"]') as HTMLElement).click()
    await flushPromises()

    const deleteCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
    expect(deleteCall?.[0]).toBe('/api/v1/input/files?path=sub%2FDJI_0042.MP4')
    expect(input.files).toEqual([])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('cancelling the confirm step disarms it without deleting', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    await mountSheet()

    ;(q('[data-testid="sheet-delete"]') as HTMLElement).click()
    await flushPromises()
    ;(q('[data-testid="sheet-delete-cancel"]') as HTMLElement).click()
    await flushPromises()

    expect(q('[data-testid="sheet-delete-confirm"]')).toBeNull()
    expect(q('[data-testid="sheet-delete"]')).not.toBeNull()
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')).toBe(false)
  })
})
