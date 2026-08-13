import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import JobItemsList from '../JobItemsList.vue'
import { fetchJobItems } from '@/api/jobs'
import { createI18nInstance } from '@/i18n'
import type { JobItem } from '@/types/api'

vi.mock('@/api/jobs', () => ({
  fetchJobs: vi.fn(),
  fetchJob: vi.fn(),
  fetchJobItems: vi.fn(),
}))

const mockedFetchJobItems = vi.mocked(fetchJobItems)

function makeItem(id: number, over: Partial<JobItem> = {}): JobItem {
  return {
    id,
    job_id: 7,
    source_path: `IMG_${id}.jpg`,
    size_bytes: 1024,
    media_type: 'photo',
    orientation: null,
    taken_at: null,
    camera_make: null,
    camera_model: null,
    matched_rule_id: null,
    planned_dest: `2024/08/croacia/photo/IMG_${id}.jpg`,
    final_dest: `2024/08/croacia/photo/IMG_${id}.jpg`,
    status: 'done',
    error: null,
    content_hash: null,
    collision: null,
    ...over,
  }
}

function mountList(jobId = 7) {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(JobItemsList, {
    props: { jobId },
    global: { plugins: [pinia, createI18nInstance()] },
  })
}

describe('JobItemsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the first page on mount (spinner in flight) and renders source → dest rows', async () => {
    mockedFetchJobItems.mockResolvedValue([makeItem(1)])
    const wrapper = mountList()
    expect(wrapper.find('[data-testid="job-items-spinner"]').exists()).toBe(true)

    await flushPromises()
    expect(mockedFetchJobItems).toHaveBeenCalledWith(7, { limit: 50, offset: 0 })
    const row = wrapper.get('[data-testid="job-item-row"]')
    expect(row.text()).toContain('IMG_1.jpg')
    expect(row.text()).toContain('2024/08/croacia/photo/IMG_1.jpg')
  })

  it('groups error items first, with the slug resolved via errors.* or shown raw as fallback', async () => {
    mockedFetchJobItems.mockResolvedValue([
      makeItem(1),
      makeItem(2, { status: 'error', error: 'invalid_path', final_dest: null }),
      makeItem(3, { status: 'skipped', final_dest: null }),
      makeItem(4, { status: 'error', error: 'slug_marciano_sin_traducir', final_dest: null }),
    ])
    const wrapper = mountList()
    await flushPromises()

    // errores primero, en orden del server; el resto detrás
    const rows = wrapper.findAll('[data-testid="job-item-error"], [data-testid="job-item-row"]')
    expect(rows.map((r) => r.attributes('data-testid'))).toEqual([
      'job-item-error',
      'job-item-error',
      'job-item-row',
      'job-item-row',
    ])
    // slug con traducción en errors.* → texto resuelto
    expect(rows[0].text()).toContain('IMG_2.jpg')
    expect(rows[0].text()).toContain('Esa ruta no es válida.')
    // slug sin traducción → crudo (mejor pista críptica que "algo falló")
    expect(rows[1].text()).toContain('slug_marciano_sin_traducir')
    // estado no-done con etiqueta de texto (el icono solo no distingue)
    expect(rows[2].text()).toContain('IMG_1.jpg')
    expect(rows[3].text()).toContain('saltado')
  })

  it('paginates with "cargar más" while the last page comes back full (page size 50)', async () => {
    const firstPage = Array.from({ length: 50 }, (_, i) => makeItem(i + 1))
    const secondPage = Array.from({ length: 20 }, (_, i) => makeItem(i + 51))
    mockedFetchJobItems.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage)

    const wrapper = mountList()
    await flushPromises()
    expect(wrapper.findAll('[data-testid="job-item-row"]')).toHaveLength(50)

    await wrapper.get('[data-testid="job-items-load-more"]').trigger('click')
    await flushPromises()
    expect(mockedFetchJobItems).toHaveBeenLastCalledWith(7, { limit: 50, offset: 50 })
    expect(wrapper.findAll('[data-testid="job-item-row"]')).toHaveLength(70)
    // página incompleta → no hay más que cargar
    expect(wrapper.find('[data-testid="job-items-load-more"]').exists()).toBe(false)
  })

  it('shows the empty message for a job without items', async () => {
    mockedFetchJobItems.mockResolvedValue([])
    const wrapper = mountList()
    await flushPromises()
    expect(wrapper.get('[data-testid="job-items-empty"]').text()).toBe(
      'Este trabajo no tiene archivos.',
    )
    expect(wrapper.find('[data-testid="job-items-load-more"]').exists()).toBe(false)
  })

  it('offers a retry after a first-page failure and recovers on click', async () => {
    mockedFetchJobItems
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce([makeItem(1)])
    const wrapper = mountList()
    await flushPromises()
    expect(wrapper.find('[data-testid="job-item-row"]').exists()).toBe(false)

    await wrapper.get('[data-testid="job-items-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="job-item-row"]').text()).toContain('IMG_1.jpg')
  })
})
