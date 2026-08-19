import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UploadView from '../UploadView.vue'
import { createI18nInstance } from '@/i18n'
import { router } from '@/router'
import { useUploadsStore } from '@/stores/uploads'

// las subidas reales no pintan nada aquí: uploadFile se queda en vuelo (una
// promesa que nunca resuelve) para que la cola conserve sus filas
vi.mock('@/api/uploads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/uploads')>()),
  uploadFile: vi.fn(() => ({ promise: new Promise(() => {}), abort: vi.fn() })),
}))

// la cola no debe montar una fila por archivo: con cientos/miles de ficheros
// eso es crear (y retener) miles de componentes y sus nodos, que es justo lo
// que content-visibility NO ahorra. Ver useVirtualRows.
function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return mount(UploadView, {
    global: { plugins: [pinia, router, createI18nInstance()] },
    attachTo: document.body,
  })
}

function files(n: number) {
  return Array.from({ length: n }, (_, i) => new File(['x'], `foto-${i}.jpg`, { type: 'image/jpeg' }))
}

describe('UploadView', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock')
    URL.revokeObjectURL = vi.fn()
    // el encolado empuja por tandas cediendo el hilo: aquí se ejecuta ya
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      cb()
      return 1
    })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('renders every row for a short queue', async () => {
    const wrapper = mountView()
    useUploadsStore().enqueue(files(5))
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('[data-testid="item-name"]')).toHaveLength(5)
    // sin virtualizar: cero huecos reservados
    expect(wrapper.get('[data-testid="upload-queue"]').attributes('style')).toBe(
      'padding-top: 0px; padding-bottom: 0px;',
    )
  })

  it('mounts only a window of rows for a long queue, reserving the rest as padding', async () => {
    const wrapper = mountView()
    useUploadsStore().enqueue(files(600))
    await wrapper.vm.$nextTick()

    const rows = wrapper.findAll('[data-testid="item-name"]')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(60)
    // el hueco de las filas no montadas se reserva abajo: el alto total de la
    // lista (y con él la barra de scroll) sigue siendo el de la cola entera
    const style = wrapper.get('[data-testid="upload-queue"]').attributes('style') ?? ''
    expect(style).toContain('padding-bottom')
    // una miniatura por fila MONTADA, no una por archivo de la cola
    expect(URL.createObjectURL).toHaveBeenCalledTimes(rows.length)
  })
})
