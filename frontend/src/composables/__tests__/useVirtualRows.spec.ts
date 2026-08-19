import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useVirtualRows } from '../useVirtualRows'

// Alto de fila del banco de pruebas (el de la cola real es 72)
const ROW = 72
const OVERSCAN = 2
const THRESHOLD = 10
const VIEWPORT = 720

// Componente de prueba: un scroller con la lista dentro, igual que el <main>
// del shell con la cola. Render function (no template) porque el build de
// test de Vue no trae compilador.
function makeHarness(initialCount: number) {
  return defineComponent({
    setup() {
      const count = ref(initialCount)
      const rows = useVirtualRows(computed(() => count.value), {
        rowHeight: ROW,
        overscan: OVERSCAN,
        threshold: THRESHOLD,
      })
      return { count, ...rows, setList: (el: unknown) => (rows.listEl.value = el as HTMLElement) }
    },
    render() {
      return h('div', { class: 'scroller', style: 'overflow-y: auto' }, [
        h(
          'ul',
          {
            ref: this.setList,
            style: { paddingTop: `${this.padTop}px`, paddingBottom: `${this.padBottom}px` },
          },
          Array.from({ length: this.end - this.start }, (_, i) =>
            h('li', { key: this.start + i, 'data-index': this.start + i }, `fila ${this.start + i}`),
          ),
        ),
      ])
    },
  })
}

// el árbol tiene que estar EN el documento: getComputedStyle de un elemento
// suelto no devuelve nada y la detección del scroller (overflow-y) fallaría
function mountHarness(count: number) {
  return mount(makeHarness(count), { attachTo: document.body })
}

// scroll simulado: la lista sube (rect.top negativo) según el scroller baja
function stubGeometry(wrapper: ReturnType<typeof mount>) {
  const scroller = wrapper.get('.scroller').element as HTMLElement
  const list = wrapper.get('ul').element as HTMLElement
  Object.defineProperty(scroller, 'clientHeight', { value: VIEWPORT, configurable: true })
  vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect)
  let scrollTop = 0
  vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => ({ top: -scrollTop }) as DOMRect)
  return {
    async scrollTo(px: number) {
      scrollTop = px
      scroller.dispatchEvent(new Event('scroll'))
      await wrapper.vm.$nextTick()
    },
  }
}

describe('useVirtualRows', () => {
  beforeEach(() => {
    // rAF síncrono: el composable agrupa las mediciones por frame
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  it('renders the whole list below the threshold, with no spacers', async () => {
    const wrapper = mountHarness(THRESHOLD)
    const { scrollTo } = stubGeometry(wrapper)
    await scrollTo(0)

    expect(wrapper.findAll('li')).toHaveLength(THRESHOLD)
    expect(wrapper.vm.virtual).toBe(false)
    expect(wrapper.vm.padTop).toBe(0)
    expect(wrapper.vm.padBottom).toBe(0)
  })

  it('mounts only the visible window (plus overscan) for a long list', async () => {
    const wrapper = mountHarness(2000)
    const { scrollTo } = stubGeometry(wrapper)
    await scrollTo(0)

    // 720/72 = 10 filas visibles + overscan por los dos lados
    const expected = Math.ceil(VIEWPORT / ROW) + OVERSCAN * 2
    expect(wrapper.vm.virtual).toBe(true)
    expect(wrapper.findAll('li')).toHaveLength(expected)
    expect(wrapper.vm.start).toBe(0)
    // el hueco de las 1986 que no se montan queda reservado abajo
    expect(wrapper.vm.padBottom).toBe((2000 - expected) * ROW)
  })

  it('moves the window on scroll and keeps the total height exact', async () => {
    const count = 2000
    const wrapper = mountHarness(count)
    const { scrollTo } = stubGeometry(wrapper)

    await scrollTo(ROW * 100)
    // 100 filas por encima menos el overscan
    expect(wrapper.vm.start).toBe(100 - OVERSCAN)
    expect(wrapper.vm.padTop).toBe((100 - OVERSCAN) * ROW)
    expect((wrapper.get('li').element as HTMLElement).dataset.index).toBe(String(100 - OVERSCAN))

    // el alto total (huecos + filas montadas) es SIEMPRE el de la lista
    // completa: la barra de scroll no miente ni salta
    const rendered = wrapper.findAll('li').length
    expect(wrapper.vm.padTop + rendered * ROW + wrapper.vm.padBottom).toBe(count * ROW)

    // y al volver arriba se rebobina
    await scrollTo(0)
    expect(wrapper.vm.start).toBe(0)
  })

  // las alturas de Tailwind van en rem: con otra tipografía base (o zoom de
  // texto) la fila no mide lo que dice la constante. La medida real manda.
  it('corrects the row height from the row actually rendered', async () => {
    const wrapper = mountHarness(500)
    const { scrollTo } = stubGeometry(wrapper)
    await scrollTo(0)
    expect(wrapper.vm.rowHeight).toBe(ROW)

    const li = wrapper.get('li').element as HTMLElement
    vi.spyOn(li, 'getBoundingClientRect').mockReturnValue({ height: 90 } as DOMRect)
    await scrollTo(90 * 10) // diez filas de 90px

    expect(wrapper.vm.rowHeight).toBe(90)
    expect(wrapper.vm.start).toBe(10 - OVERSCAN)
    expect(wrapper.vm.padTop).toBe((10 - OVERSCAN) * 90)
  })

  it('clamps the window at the end of the list', async () => {
    const count = 300
    const wrapper = mountHarness(count)
    const { scrollTo } = stubGeometry(wrapper)
    await scrollTo(ROW * count) // pasado el final

    expect(wrapper.vm.end).toBe(count)
    expect(wrapper.vm.padBottom).toBe(0)
    expect(wrapper.vm.start).toBeLessThan(count)
  })

  it('recomputes when the list grows and drops its listeners on unmount', async () => {
    const wrapper = mountHarness(500)
    const { scrollTo } = stubGeometry(wrapper)
    await scrollTo(0)
    const before = wrapper.vm.padBottom

    wrapper.vm.count = 900
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.padBottom).toBe(before + 400 * ROW)

    const scroller = wrapper.get('.scroller').element as HTMLElement
    const remove = vi.spyOn(scroller, 'removeEventListener')
    wrapper.unmount()
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})
