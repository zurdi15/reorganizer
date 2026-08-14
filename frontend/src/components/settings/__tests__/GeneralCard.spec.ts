import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GeneralCard from '../GeneralCard.vue'
import { createI18nInstance } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'
import { useToastStore } from '@/stores/toast'
import type { Settings } from '@/types/api'

const SETTINGS: Settings = {
  immich_enabled: false,
  immich_url: '',
  immich_api_key: '',
  immich_library_id: '',
  default_duplicate_strategy: 'rename',
  default_transfer_mode: 'move',
  upload_duplicate_strategy: 'skip',
}

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

function mountCard(settings: Settings = SETTINGS) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSettingsStore()
  store.settings = { ...settings }
  const wrapper = mount(GeneralCard, {
    global: { plugins: [pinia, createI18nInstance()] },
  })
  return { wrapper, store }
}

// segmentos (role=radio) de UNO de los tres controles de la tarjeta
function segments(wrapper: ReturnType<typeof mount>, testid: string) {
  return wrapper.findAll(`[data-testid="${testid}"] [role="radio"]`)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GeneralCard', () => {
  it('shows the upload duplicate control with skip selected by default', () => {
    const { wrapper } = mountCard()
    const options = segments(wrapper, 'general-upload-duplicates')
    // al SUBIR solo hay dos opciones: sobrescribir perdería datos
    expect(options.map((o) => o.text())).toEqual(['Saltar', 'Renombrar'])
    expect(options[0].attributes('aria-checked')).toBe('true')
  })

  it('persists the upload strategy on tap and confirms with a debounced toast', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ ...SETTINGS, upload_duplicate_strategy: 'rename' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper, store } = mountCard()

    await segments(wrapper, 'general-upload-duplicates')[1].trigger('click')
    await flushPromises()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/settings')
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({ upload_duplicate_strategy: 'rename' })
    // el estado sale SIEMPRE de la respuesta del server
    expect(store.settings?.upload_duplicate_strategy).toBe('rename')

    expect(useToastStore().toasts).toHaveLength(0)
    vi.advanceTimersByTime(600)
    expect(useToastStore().toasts.at(-1)?.kind).toBe('ok')
    vi.useRealTimers()
  })

  it('keeps the job defaults on their own controls (organize ≠ upload)', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ ...SETTINGS }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = mountCard()

    // el control de organizar sí ofrece sobrescribir
    expect(segments(wrapper, 'general-duplicates').map((o) => o.text())).toEqual([
      'Renombrar',
      'Saltar',
      'Sobrescribir',
    ])
    await segments(wrapper, 'general-duplicates')[1].trigger('click')
    await flushPromises()
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      default_duplicate_strategy: 'skip',
    })
  })

  it('toasts the backend slug when saving fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ detail: 'invalid_upload_duplicate_strategy' }, 400)),
    )
    const { wrapper } = mountCard()

    await segments(wrapper, 'general-upload-duplicates')[1].trigger('click')
    await flushPromises()

    expect(useToastStore().toasts.at(-1)).toMatchObject({
      kind: 'error',
      message: 'Estrategia de duplicados de subida no válida.',
    })
  })
})
