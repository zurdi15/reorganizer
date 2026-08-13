import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import RgSheet from '../RgSheet.vue'

describe('RgSheet', () => {
  let trigger: HTMLButtonElement | null = null

  afterEach(() => {
    trigger?.remove()
    trigger = null
  })

  it('moves focus into the panel on open and restores it on close', async () => {
    trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const wrapper = mount(RgSheet, {
      props: { open: false, title: 'Ajustes' },
      attachTo: document.body,
    })

    await wrapper.setProps({ open: true })
    await nextTick()
    await nextTick()

    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel.getAttribute('tabindex')).toBe('-1')
    expect(document.activeElement).toBe(panel)

    const title = panel.querySelector('h2') as HTMLElement
    expect(title.id).toBeTruthy()
    expect(panel.getAttribute('aria-labelledby')).toBe(title.id)

    await wrapper.setProps({ open: false })
    await nextTick()
    await nextTick()

    expect(document.activeElement).toBe(trigger)

    wrapper.unmount()
  })

  // la utilidad de safe-area a secas (solo env(), sin sumar nada) competiría
  // con p-4 por el mismo lado (padding-bottom) — la clase combina el 1rem
  // base con el inset vía calc(), así el fondo nunca queda en 0 aunque el
  // inset lo sea (lección berserk, amendment C)
  it('the panel carries bottom padding that combines the 1rem scale with the safe-area inset, not env() alone', async () => {
    const wrapper = mount(RgSheet, {
      props: { open: true, title: 'Con padding' },
      attachTo: document.body,
    })
    await nextTick()
    await nextTick()

    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    expect(panel.classList.contains('pb-[calc(1rem+env(safe-area-inset-bottom))]')).toBe(true)

    wrapper.unmount()
  })

  it('traps Tab within the panel: from the last focusable it wraps to the first, Shift+Tab from the first wraps to the last', async () => {
    const wrapper = mount(RgSheet, {
      props: { open: true, title: 'Con foco' },
      attachTo: document.body,
      slots: {
        default:
          '<button data-testid="a">A</button><button data-testid="b">B</button><button data-testid="c">C</button>',
      },
    })
    await nextTick()
    await nextTick()

    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    const buttons = Array.from(panel.querySelectorAll('button')) as HTMLElement[]
    const first = buttons[0]
    const last = buttons[buttons.length - 1]

    // Tab desde el último enfocable → cicla al primero
    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    window.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(first)

    // Shift+Tab desde el primero → cicla al último
    first.focus()
    const shiftTab = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    window.dispatchEvent(shiftTab)
    expect(shiftTab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(last)

    // Tab en medio (del primero, no es el último) NO se atrapa: el navegador
    // avanza al siguiente por su cuenta
    first.focus()
    const midTab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    window.dispatchEvent(midTab)
    expect(midTab.defaultPrevented).toBe(false)

    wrapper.unmount()
  })

  it('only the topmost stacked sheet traps Tab', async () => {
    const editor = mount(RgSheet, {
      props: { open: true, title: 'Editor' },
      attachTo: document.body,
      slots: { default: '<button data-testid="e">E</button>' },
    })
    await nextTick()
    await nextTick()

    const confirm = mount(RgSheet, {
      props: { open: true, title: 'Confirmar' },
      attachTo: document.body,
      slots: { default: '<button data-testid="c1">C1</button><button data-testid="c2">C2</button>' },
    })
    await nextTick()
    await nextTick()

    // el sheet de tope (confirm) atrapa; el de debajo (editor) no reacciona
    const confirmPanel = document.querySelectorAll('[role="dialog"]')[1] as HTMLElement
    const cButtons = Array.from(confirmPanel.querySelectorAll('button')) as HTMLElement[]
    cButtons[cButtons.length - 1].focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    window.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(cButtons[0])

    editor.unmount()
    confirm.unmount()
  })

  it('closes only the topmost sheet on Escape when sheets are stacked', async () => {
    // flujo real: sheet de regla, con el sheet de confirmar borrado abierto
    // encima — un solo Escape debe cerrar solo el de arriba
    const editor = mount(RgSheet, {
      props: { open: false, title: 'Editor' },
      attachTo: document.body,
    })
    await editor.setProps({ open: true })
    await nextTick()
    await nextTick()

    const confirm = mount(RgSheet, {
      props: { open: false, title: 'Confirmar borrado' },
      attachTo: document.body,
    })
    await confirm.setProps({ open: true })
    await nextTick()
    await nextTick()

    expect(document.querySelectorAll('[role="dialog"]').length).toBe(2)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(confirm.emitted('close')).toHaveLength(1)
    expect(editor.emitted('close')).toBeUndefined()

    // el padre real reacciona al close cerrando el sheet de arriba, lo que
    // lo saca de la pila y deja el editor como tope
    await confirm.setProps({ open: false })
    await nextTick()
    await nextTick()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(editor.emitted('close')).toHaveLength(1)

    editor.unmount()
    confirm.unmount()
  })

  it('emits close on Escape when mounted already open (v-if-style consumer)', async () => {
    // algunos consumidores montan el sheet directamente con open=true detrás
    // de un v-if del padre; sin immediate:true en el watcher, este id nunca
    // entraba en la pila y Escape se lo comía en silencio
    const wrapper = mount(RgSheet, {
      props: { open: true, title: 'Ya abierto' },
      attachTo: document.body,
    })
    await nextTick()
    await nextTick()

    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
  })

  // excepción documentada al doctrine "solo entrada" — el sheet anima
  // también al cerrarse (ver el comentario en RgSheet.vue). VTU stubea
  // <Transition> por defecto, así que estos dos tests lo desactivan para
  // observar el comportamiento real.
  it('applies the sheet-specific enter transition classes to panel and backdrop on open', async () => {
    const wrapper = mount(RgSheet, {
      props: { open: false, title: 'Con animación' },
      attachTo: document.body,
      global: { stubs: { transition: false } },
    })

    await wrapper.setProps({ open: true })
    await nextTick()

    const panel = document.querySelector('[role="dialog"]') as HTMLElement
    expect(panel.classList.contains('rg-sheet-panel-enter-active')).toBe(true)

    const backdrop = document.querySelector('.bg-scrim') as HTMLElement
    expect(backdrop.classList.contains('rg-sheet-backdrop-enter-active')).toBe(true)

    wrapper.unmount()
  })

  it('initiates the leave transition on close (visual only — close still emits immediately) and the panel eventually detaches', async () => {
    const wrapper = mount(RgSheet, {
      props: { open: true, title: 'Con animación' },
      attachTo: document.body,
      global: { stubs: { transition: false } },
    })
    await nextTick()
    await nextTick()

    await wrapper.setProps({ open: false })

    // la salida es solo visual: el panel sigue montado un instante con la
    // clase de leave mientras se desliza hacia abajo
    const leavingPanel = document.querySelector('[role="dialog"]') as HTMLElement
    expect(leavingPanel).not.toBeNull()
    expect(leavingPanel.classList.contains('rg-sheet-panel-leave-active')).toBe(true)

    await vi.waitFor(
      () => {
        expect(document.querySelector('[role="dialog"]')).toBeNull()
      },
      { timeout: 1000 },
    )

    wrapper.unmount()
  })
})
