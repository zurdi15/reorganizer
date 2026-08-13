import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RuleSheet from '../RuleSheet.vue'
import type { RuleRead } from '@/api/rules'
import { createI18nInstance } from '@/i18n'

const RULE: RuleRead = {
  id: 4,
  priority: 20,
  enabled: true,
  name: 'Dron',
  media_type: 'video',
  orientation: 'vertical',
  filename_regex: '^dji',
  camera_make: 'DJI',
  camera_model: 'mini3',
  dest_template: 'video/{orientation}/dron/mini3',
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
}

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

function mountSheet(rule: RuleRead | null = RULE) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(RuleSheet, {
    props: { open: true, rule },
    global: { plugins: [pinia, createI18nInstance()] },
    attachTo: document.body,
  })
}

// la sheet teleporta a body: las queries van contra el documento
function q(selector: string): HTMLElement | null {
  return document.querySelector(selector)
}

function inputOf(testid: string): HTMLInputElement {
  return q(`[data-testid="${testid}"] input`) as HTMLInputElement
}

function setInput(testid: string, value: string) {
  const input = inputOf(testid)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function checkedLabel(testid: string): string {
  return (q(`[data-testid="${testid}"] [role="radio"][aria-checked="true"]`)?.textContent ?? '').trim()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RuleSheet', () => {
  it('seeds the form from the rule: conditions, dest template and live preview', () => {
    vi.stubGlobal('fetch', vi.fn())
    mountSheet()

    expect(inputOf('rule-name').value).toBe('Dron')
    expect(checkedLabel('rule-media-type')).toBe('Vídeo')
    expect(checkedLabel('rule-orientation')).toBe('Vertical')
    expect(inputOf('rule-regex').value).toBe('^dji')
    expect(inputOf('rule-make').value).toBe('DJI')
    expect(inputOf('rule-model').value).toBe('mini3')
    expect(inputOf('rule-dest').value).toBe('video/{orientation}/dron/mini3')
    // preview en vivo con valores de ejemplo (cliente puro, sin red)
    expect(q('[data-testid="rule-preview"]')?.textContent).toContain('video/horizontal/dron/mini3')
  })

  it('warns inline about an unknown placeholder in the live preview', async () => {
    vi.stubGlobal('fetch', vi.fn())
    mountSheet()

    setInput('rule-dest', 'video/{orientacion}')
    await flushPromises()

    expect(q('[data-testid="rule-preview"]')?.textContent).toContain('orientacion')
  })

  it('saving an edited rule PATCHes the full payload with EXPLICIT nulls for cleared conditions', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ ...RULE, filename_regex: null, camera_make: null }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountSheet()

    // vaciar dos condiciones → deben viajar como null (borrado explícito)
    setInput('rule-regex', '')
    setInput('rule-make', '')
    await flushPromises()
    ;(q('[data-testid="rule-save"]') as HTMLElement).click()
    await flushPromises()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/rules/4')
    expect(init?.method).toBe('PATCH')
    expect(JSON.parse(init?.body as string)).toEqual({
      name: 'Dron',
      media_type: 'video',
      orientation: 'vertical',
      filename_regex: null,
      camera_make: null,
      camera_model: 'mini3',
      dest_template: 'video/{orientation}/dron/mini3',
    })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('shows a 422 slug inline on its field (invalid_regex) and keeps the sheet open', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ detail: 'invalid_regex' }, 422))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountSheet()

    setInput('rule-regex', '[')
    await flushPromises()
    ;(q('[data-testid="rule-save"]') as HTMLElement).click()
    await flushPromises()

    expect(q('[data-testid="rule-regex"]')?.textContent).toContain('La expresión regular no es válida.')
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('creating a rule POSTs with null conditions; an empty dest never reaches the network', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ ...RULE, id: 9 }, 201),
    )
    vi.stubGlobal('fetch', fetchMock)
    mountSheet(null)

    // sin plantilla: error inline y CERO red
    ;(q('[data-testid="rule-save"]') as HTMLElement).click()
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(q('[data-testid="rule-dest"]')?.textContent).toContain('obligatoria')

    setInput('rule-dest', 'photo')
    await flushPromises()
    ;(q('[data-testid="rule-save"]') as HTMLElement).click()
    await flushPromises()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/rules')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      name: null,
      media_type: null,
      orientation: null,
      filename_regex: null,
      camera_make: null,
      camera_model: null,
      dest_template: 'photo',
    })
  })

  it('the tester POSTs the synthetic case to /rules/test and renders the match + dest', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse({ matched_rule_id: 4, matched_rule_name: 'Dron', dest: 'video/vertical/dron/mini3/DJI_0042.MP4' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    mountSheet()

    setInput('rule-test-filename', 'DJI_0042.MP4')
    await flushPromises()
    ;(q('[data-testid="rule-test-run"]') as HTMLElement).click()
    await flushPromises()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/rules/test')
    // orientación "cualquiera" NO viaja (el contrato la quiere ausente)
    expect(JSON.parse(init?.body as string)).toEqual({ filename: 'DJI_0042.MP4', media_type: 'video' })
    const result = q('[data-testid="rule-test-result"]')
    expect(result?.textContent).toContain('Dron')
    expect(result?.textContent).toContain('video/vertical/dron/mini3/DJI_0042.MP4')
  })

  it('renders the honest _unknown/ fallback when no rule matches the test case', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ matched_rule_id: null, matched_rule_name: null, dest: null })),
    )
    mountSheet()

    setInput('rule-test-filename', 'nota.txt')
    await flushPromises()
    ;(q('[data-testid="rule-test-run"]') as HTMLElement).click()
    await flushPromises()

    expect(q('[data-testid="rule-test-result"]')?.textContent).toContain('Sin regla → _unknown/')
  })

  it('deletes only after the in-sheet confirm step, then closes', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, json: async () => ({}) }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountSheet()

    ;(q('[data-testid="rule-delete"]') as HTMLElement).click()
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled()

    ;(q('[data-testid="rule-delete-confirm"]') as HTMLElement).click()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/rules/4', expect.objectContaining({ method: 'DELETE' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
