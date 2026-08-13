import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlanPreview from '../PlanPreview.vue'
import { createI18nInstance } from '@/i18n'
import { useJobsStore } from '@/stores/jobs'
import { useOrganizeStore } from '@/stores/organize'
import type { JobItem, JobRead } from '@/types/api'

const DEST = '2024/08/croacia'

function makeJob(over: Partial<JobRead> = {}): JobRead {
  return {
    id: 7,
    status: 'planned',
    dest_path: DEST,
    transfer_mode: 'move',
    duplicate_strategy: 'rename',
    total: 4,
    done: 0,
    errors: 0,
    skipped: 0,
    error: null,
    immich_status: null,
    created_at: '2026-08-13T10:00:00Z',
    started_at: null,
    finished_at: null,
    ...over,
  }
}

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
    matched_rule_id: 1,
    planned_dest: `${DEST}/photo/IMG_${id}.jpg`,
    final_dest: null,
    status: 'planned',
    error: null,
    content_hash: null,
    collision: false,
    ...over,
  }
}

const ITEMS: JobItem[] = [
  makeItem(1),
  makeItem(2, { collision: true }),
  makeItem(3, {
    source_path: 'DJI_0042.MP4',
    media_type: 'video',
    planned_dest: `${DEST}/video/horizontal/dron/mini3/DJI_0042.MP4`,
  }),
  makeItem(4, {
    source_path: 'notas.txt',
    media_type: 'unknown',
    matched_rule_id: null,
    planned_dest: `${DEST}/_unknown/notas.txt`,
  }),
]

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

async function mountPreview(job: JobRead = makeJob()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const organize = useOrganizeStore()
  const jobs = useJobsStore()
  jobs.activeJob = job
  const wrapper = mount(PlanPreview, {
    global: { plugins: [pinia, createI18nInstance()] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, organize, jobs }
}

describe('PlanPreview', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/items')) return jsonResponse(ITEMS)
        return jsonResponse([])
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pins the warnings first: no-rule → _unknown/ and predicted duplicates → current strategy', async () => {
    const { wrapper } = await mountPreview()

    const unknown = wrapper.get('[data-testid="plan-warning-unknown"]')
    expect(unknown.text()).toContain('1 archivo sin regla → _unknown/')
    // expandible a la lista de archivos (texto plano)
    await unknown.get('button').trigger('click')
    expect(wrapper.get('[data-testid="plan-warning-unknown-list"]').text()).toContain('notas.txt')

    const collisions = wrapper.get('[data-testid="plan-warning-collisions"]')
    // la estrategia ACTUAL del job (rename) interpolada
    expect(collisions.text()).toContain('1 duplicado previsto → Renombrar')
    await collisions.get('button').trigger('click')
    expect(wrapper.get('[data-testid="plan-warning-collisions-list"]').text()).toContain('IMG_2.jpg')
  })

  it('groups by dest subfolder with counts, collapsed by default; _unknown stays out of the groups', async () => {
    const { wrapper } = await mountPreview()

    const names = wrapper.findAll('[data-testid="plan-group-name"]').map((n) => n.text())
    expect(names).toEqual(['photo', 'video/horizontal/dron/mini3'])
    const counts = wrapper.findAll('[data-testid="plan-group-count"]').map((c) => c.text())
    expect(counts).toEqual(['2 archivos', '1 archivo'])

    // colapsado por defecto (mobile-first)
    expect(wrapper.find('[data-testid="plan-group-rows"]').exists()).toBe(false)
    await wrapper.findAll('[data-testid="plan-group-toggle"]')[0].trigger('click')
    const rows = wrapper.findAll('[data-testid="plan-row"]')
    expect(rows).toHaveLength(2)
    // origen → destino relativo, en texto
    expect(rows[0].text()).toContain('IMG_1.jpg')
    expect(rows[0].text()).toContain('photo/IMG_1.jpg')
  })

  it('while planning shows the dry-run progress and a working cancel', async () => {
    const { wrapper, jobs } = await mountPreview(makeJob({ status: 'planning', total: 0 }))
    jobs.planProgress = { scanned: 42, total: 120 }
    await flushPromises()

    const planning = wrapper.get('[data-testid="plan-planning"]')
    expect(planning.text()).toContain('42/120')

    await wrapper.get('[data-testid="plan-cancel"]').trigger('click')
    await flushPromises()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/v1/jobs/7/cancel',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('footer: Volver returns to compose without losing segments; Organizar… opens the confirm sheet', async () => {
    const { wrapper, organize } = await mountPreview()

    await wrapper.get('[data-testid="plan-organize"]').trigger('click')
    // la sheet teleporta a body
    expect(document.querySelector('[data-testid="confirm-commit"]')).not.toBeNull()

    await wrapper.get('[data-testid="plan-back"]').trigger('click')
    expect(organize.stage).toBe('compose')
    expect(organize.destSegments).toEqual(['2024', '08', 'croacia'])
  })
})
