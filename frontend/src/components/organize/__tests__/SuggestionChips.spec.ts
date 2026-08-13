import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import SuggestionChips from '../SuggestionChips.vue'
import { createI18nInstance } from '@/i18n'
import { useInputStore } from '@/stores/input'
import { useJobsStore } from '@/stores/jobs'
import { useOrganizeStore } from '@/stores/organize'
import type { JobRead } from '@/types/api'

function makeJob(over: Partial<JobRead> = {}): JobRead {
  return {
    id: 1,
    status: 'completed',
    dest_path: '2023/verano',
    transfer_mode: 'move',
    duplicate_strategy: 'rename',
    total: 3,
    done: 3,
    errors: 0,
    skipped: 0,
    error: null,
    immich_status: 'ok',
    created_at: '2026-08-01T10:00:00Z',
    started_at: null,
    finished_at: '2026-08-01T10:05:00Z',
    ...over,
  }
}

function mountChips() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const input = useInputStore()
  const jobs = useJobsStore()
  const organize = useOrganizeStore()
  // años y meses llegan como STRINGS del backend (meses zero-padded)
  input.dates = { years: ['2023', '2024'], months_by_year: { '2024': ['08', '03'] } }
  jobs.history = [makeJob({ id: 2, dest_path: '2024/08/croacia' }), makeJob({ id: 1 })]
  const wrapper = mount(SuggestionChips, {
    global: { plugins: [pinia, createI18nInstance()] },
  })
  return { wrapper, organize }
}

describe('SuggestionChips', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as unknown as Response))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is a horizontal scroller opted out of the shell swipe (data-no-swipe + no-scrollbar)', () => {
    const { wrapper } = mountChips()
    const scroller = wrapper.get('[data-testid="suggestion-chips"]')
    expect(scroller.attributes('data-no-swipe')).toBeDefined()
    expect(scroller.classes()).toContain('no-scrollbar')
    expect(scroller.classes()).toContain('overflow-x-auto')
  })

  it('year chips APPEND a segment; the months of that year then appear zero-padded', async () => {
    const { wrapper, organize } = mountChips()
    // años más recientes primero (getter del input store); sin año
    // confirmado aún no hay chips de mes
    const years = wrapper.findAll('[data-testid="suggestion-year"]')
    expect(years.map((y) => y.text())).toEqual(['2024', '2023'])
    expect(wrapper.findAll('[data-testid="suggestion-month"]')).toHaveLength(0)

    await years[0].trigger('click')
    expect(organize.destSegments).toEqual(['2024'])

    await nextTick()
    // el año aplicado desaparece de los chips y aparecen sus meses (asc,
    // SIEMPRE con cero: la carpeta es 03, no 3)
    expect(wrapper.findAll('[data-testid="suggestion-year"]').map((y) => y.text())).toEqual(['2023'])
    const months = wrapper.findAll('[data-testid="suggestion-month"]')
    expect(months.map((m) => m.text())).toEqual(['03', '08'])

    await months[1].trigger('click')
    expect(organize.destSegments).toEqual(['2024', '08'])
  })

  it('a recent chip REPLACES the whole path (never appends)', async () => {
    const { wrapper, organize } = mountChips()
    organize.setFromPath('2023/otra/cosa')

    const recents = wrapper.findAll('[data-testid="suggestion-recent"]')
    expect(recents.map((r) => r.text())).toEqual(['2024/08/croacia', '2023/verano'])

    await recents[0].trigger('click')
    expect(organize.destSegments).toEqual(['2024', '08', 'croacia'])
  })

  it('renders nothing when there are no EXIF dates nor recent jobs', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useInputStore().dates = { years: [], months_by_year: {} }
    const wrapper = mount(SuggestionChips, {
      global: { plugins: [pinia, createI18nInstance()] },
    })
    expect(wrapper.find('[data-testid="suggestion-chips"]').exists()).toBe(false)
  })
})
