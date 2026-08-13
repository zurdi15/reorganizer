import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RunConfirmSheet from '../RunConfirmSheet.vue'
import { createI18nInstance } from '@/i18n'
import { useJobsStore } from '@/stores/jobs'
import { useOrganizeStore } from '@/stores/organize'
import type { JobRead } from '@/types/api'

function makeJob(over: Partial<JobRead> = {}): JobRead {
  return {
    id: 7,
    status: 'planned',
    dest_path: '2024/08/croacia',
    transfer_mode: 'move',
    duplicate_strategy: 'rename',
    total: 39,
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

function jsonResponse(data: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => data } as unknown as Response
}

// la sheet teleporta a body: los queries van contra document
function q(testid: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${testid}"]`)
}

async function mountSheet() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const organize = useOrganizeStore()
  const jobs = useJobsStore()
  jobs.activeJob = makeJob()
  await nextTick()
  const wrapper = mount(RunConfirmSheet, {
    props: { open: true },
    global: { plugins: [pinia, createI18nInstance()] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, organize, jobs }
}

describe('RunConfirmSheet', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/api/v1/jobs' && init?.method === 'POST') {
          const body = JSON.parse(init.body as string) as Record<string, string>
          return jsonResponse(makeJob({ id: 8, status: 'planning', total: 0, ...body }), 202)
        }
        if (url.endsWith('/execute')) return jsonResponse(makeJob({ status: 'running' }), 202)
        // re-fetch REST anti-cuelgue (createPlan re-lee el job nuevo que vuelve
        // del POST en planning por si el broadcast planned se perdió)
        const m = /\/jobs\/(\d+)$/.exec(url)
        if (m) return jsonResponse(makeJob({ id: Number(m[1]), status: 'planning', total: 0 }))
        return jsonResponse([])
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the summary and initializes the segments from the planned job echo', async () => {
    await mountSheet()

    expect(q('confirm-summary')!.textContent).toContain('39 archivos → /output/2024/08/croacia')

    const checked = [...document.querySelectorAll('[role="radio"][aria-checked="true"]')].map(
      (el) => el.textContent?.trim(),
    )
    expect(checked).toEqual(['Mover', 'Renombrar'])
    // el commit nombra la acción y el volumen
    expect(q('confirm-commit')!.textContent).toContain('Mover 39 archivos')
  })

  it('changing an option re-plans (new POST /jobs) and blocks the commit meanwhile', async () => {
    await mountSheet()
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>

    const copy = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (el) => el.textContent?.trim() === 'Copiar',
    )!
    copy.click()
    await flushPromises()

    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/v1/jobs')!
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      dest_path: '2024/08/croacia',
      transfer_mode: 'copy',
    })
    // el job nuevo está planning: replanning visible y commit deshabilitado
    await nextTick()
    expect(q('confirm-replanning')).not.toBeNull()
    expect((q('confirm-commit') as HTMLButtonElement).disabled).toBe(true)
    expect(q('confirm-commit')!.textContent).toContain('Copiar')
  })

  it('commit executes the planned job and closes the sheet', async () => {
    const { wrapper, organize } = await mountSheet()

    ;(q('confirm-commit') as HTMLButtonElement).click()
    await flushPromises()

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/v1/jobs/7/execute',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(organize.stage).toBe('running')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
