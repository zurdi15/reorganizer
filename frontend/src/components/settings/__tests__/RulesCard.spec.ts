import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RulesCard from '../RulesCard.vue'
import type { RuleRead } from '@/api/rules'
import { createI18nInstance } from '@/i18n'
import { useSettingsStore } from '@/stores/settings'

function makeRule(id: number, priority: number, over: Partial<RuleRead> = {}): RuleRead {
  return {
    id,
    priority,
    enabled: true,
    name: null,
    media_type: null,
    orientation: null,
    filename_regex: null,
    camera_make: null,
    camera_model: null,
    dest_template: 'photo',
    created_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-01T10:00:00Z',
    ...over,
  }
}

const RULES = [
  makeRule(1, 10, { name: 'Fotos', media_type: 'photo' }),
  makeRule(2, 20, {
    media_type: 'video',
    orientation: 'vertical',
    filename_regex: '^dji',
    dest_template: 'video/{orientation}/dron/mini3',
  }),
  makeRule(3, 30, { name: 'Resto vídeo', media_type: 'video', dest_template: 'video/{orientation}/phone' }),
]

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

function mountCard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useSettingsStore()
  store.rules = RULES.map((rule) => ({ ...rule }))
  const wrapper = mount(RulesCard, {
    global: { plugins: [pinia, createI18nInstance()] },
    attachTo: document.body,
  })
  return { wrapper, store }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RulesCard', () => {
  it('renders rules in priority order, with the condition summary as name fallback', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { wrapper } = mountCard()

    const rows = wrapper.findAll('[data-testid^="rule-row-"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('Fotos')
    // sin nombre → resumen de condiciones "vídeo · vertical · ^dji"
    expect(rows[1].text()).toContain('vídeo · vertical · ^dji')
    // dest_template SIEMPRE visible en mono
    expect(rows[1].text()).toContain('video/{orientation}/dron/mini3')
  })

  it('disables ↑ on the first row and ↓ on the last one', () => {
    vi.stubGlobal('fetch', vi.fn())
    const { wrapper } = mountCard()

    expect(wrapper.find('[data-testid="rule-up-1"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="rule-down-1"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-testid="rule-down-3"]').attributes('disabled')).toBeDefined()
  })

  it('↓ posts the FULL id permutation to /rules/reorder', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([RULES[1], RULES[0], RULES[2]].map((rule, i) => ({ ...rule, priority: (i + 1) * 10 }))),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper, store } = mountCard()

    await wrapper.find('[data-testid="rule-down-1"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/rules/reorder',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: [2, 1, 3] }) }),
    )
    expect(store.rules.map((rule) => rule.id)).toEqual([2, 1, 3])
  })

  it('the inline switch PATCHes enabled without opening the sheet', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ...RULES[0], enabled: false }))
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = mountCard()

    await wrapper.find('[data-testid="rule-toggle-1"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/rules/1',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ enabled: false }) }),
    )
    // sin sheet: el toggle no debe abrir el editor
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('opens the sheet to create (empty) and to edit (prefilled)', async () => {
    vi.stubGlobal('fetch', vi.fn())
    const { wrapper } = mountCard()

    await wrapper.find('[data-testid="rule-add"]').trigger('click')
    await flushPromises()
    let dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).toContain('Nueva regla')

    // abrir en modo edición desde el cuerpo de una fila (la sheet re-siembra)
    await wrapper.find('[data-testid="rule-edit-2"]').trigger('click')
    await flushPromises()
    dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).toContain('Editar regla')
    const regexInput = dialog.querySelector('[data-testid="rule-regex"] input') as HTMLInputElement
    expect(regexInput.value).toBe('^dji')
  })
})
