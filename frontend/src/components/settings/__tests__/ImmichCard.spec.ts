import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ImmichCard from '../ImmichCard.vue'
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
}

const LIBRARIES = [
  { id: 'lib1', name: 'Fotos familia' },
  { id: 'lib2', name: 'Backup' },
]

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

function mountCard(settings: Settings = SETTINGS) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSettingsStore()
  store.settings = { ...settings }
  const wrapper = mount(ImmichCard, {
    global: { plugins: [pinia, createI18nInstance()] },
    attachTo: document.body,
  })
  return { wrapper, store }
}

function inputOf(wrapper: ReturnType<typeof mount>, testid: string): HTMLInputElement {
  return wrapper.find(`[data-testid="${testid}"] input`).element as HTMLInputElement
}

async function setInput(wrapper: ReturnType<typeof mount>, testid: string, value: string) {
  await wrapper.find(`[data-testid="${testid}"] input`).setValue(value)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ImmichCard', () => {
  it('seeds the form from the store, with the api key shown MASKED', () => {
    const { wrapper } = mountCard({
      ...SETTINGS,
      immich_enabled: true,
      immich_url: 'http://immich.local',
      immich_api_key: '****9999',
      immich_library_id: 'lib1',
    })

    expect(inputOf(wrapper, 'immich-url').value).toBe('http://immich.local')
    const keyInput = inputOf(wrapper, 'immich-api-key')
    expect(keyInput.value).toBe('****9999')
    expect(keyInput.type).toBe('password')
    expect(
      wrapper.find('[data-testid="immich-enabled"]').attributes('aria-checked'),
    ).toBe('true')
  })

  it('test-connection success: shows the version, persists credentials and fills the library select', async () => {
    const calls: string[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url === '/api/v1/settings/immich/test') return jsonResponse({ ok: true, version: 'v1.135.3' })
      if (url === '/api/v1/settings' && init?.method === 'PUT') {
        return jsonResponse({ ...SETTINGS, immich_url: 'http://immich.local', immich_api_key: '****cret' })
      }
      if (url === '/api/v1/settings/immich/libraries') return jsonResponse(LIBRARIES)
      throw new Error(`ruta sin mock: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = mountCard()

    await setInput(wrapper, 'immich-url', 'http://immich.local')
    await setInput(wrapper, 'immich-api-key', 'topsecret')
    await wrapper.find('[data-testid="immich-test"]').trigger('click')
    await flushPromises()

    // orden del flujo: probar (con override) → persistir → listar librerías
    expect(calls).toEqual([
      'POST /api/v1/settings/immich/test',
      'PUT /api/v1/settings',
      'GET /api/v1/settings/immich/libraries',
    ])
    const testBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string)
    expect(testBody).toEqual({ url: 'http://immich.local', api_key: 'topsecret' })

    // la versión del servidor queda visible junto al botón
    expect(wrapper.find('[data-testid="immich-version"]').text()).toContain('v1.135.3')
    // y el campo de la key ya muestra la máscara del server, no el secreto
    expect(inputOf(wrapper, 'immich-api-key').value).toBe('****cret')

    // el RgSelect ofrece las librerías reales
    await wrapper.find('[data-testid="immich-library"] button').trigger('click')
    await flushPromises()
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim())
    expect(options).toContain('Fotos familia')
    expect(options).toContain('Backup')
  })

  it('selecting a library and saving persists the whole immich block', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/v1/settings/immich/test') return jsonResponse({ ok: true, version: 'v1.135.3' })
      if (url === '/api/v1/settings' && init?.method === 'PUT') return jsonResponse({ ...SETTINGS })
      if (url === '/api/v1/settings/immich/libraries') return jsonResponse(LIBRARIES)
      throw new Error(`ruta sin mock: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = mountCard()

    await setInput(wrapper, 'immich-url', 'http://immich.local')
    await setInput(wrapper, 'immich-api-key', 'topsecret')
    await wrapper.find('[data-testid="immich-test"]').trigger('click')
    await flushPromises()

    // elegir "Backup" en el listbox teleportado
    await wrapper.find('[data-testid="immich-library"] button').trigger('click')
    await flushPromises()
    const backup = [...document.querySelectorAll('[role="option"]')].find(
      (o) => o.textContent?.includes('Backup'),
    ) as HTMLElement
    backup.click()
    await flushPromises()

    await wrapper.find('[data-testid="immich-enabled"]').trigger('click')
    await wrapper.find('[data-testid="immich-save"]').trigger('click')
    await flushPromises()

    const saveCall = fetchMock.mock.calls.at(-1)
    expect(saveCall?.[0]).toBe('/api/v1/settings')
    expect(JSON.parse(saveCall?.[1]?.body as string)).toMatchObject({
      immich_enabled: true,
      immich_library_id: 'lib2',
    })
  })

  it('test-connection failure: toasts the slug and neither persists nor lists libraries', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/v1/settings/immich/test') return jsonResponse({ detail: 'immich_unreachable' }, 502)
      throw new Error(`ruta sin mock: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = mountCard()
    const toast = useToastStore()

    await setInput(wrapper, 'immich-url', 'http://immich.local')
    await setInput(wrapper, 'immich-api-key', 'topsecret')
    await wrapper.find('[data-testid="immich-test"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(toast.toasts.at(-1)).toMatchObject({
      kind: 'error',
      message: 'No se pudo contactar con Immich. Revisa la URL.',
    })
    expect(wrapper.find('[data-testid="immich-version"]').exists()).toBe(false)
  })
})
