import { nextTick, onBeforeUnmount, ref } from 'vue'
import { isTopLayer, popLayer, pushLayer } from '@/lib/layerStack'

// alto de RESERVA, solo para el primerísimo pintado: el panel aún no está en
// el DOM cuando hay que decidir dónde pintarlo por primera vez (v-if="open"
// todavía no ha latido), así que no hay nada real que medir. Corregido un
// tick después con el alto MEDIDO de verdad (ver openPanel).
const FALLBACK_HEIGHT_PX = 256
const VIEWPORT_MARGIN_PX = 8

// Composable de RgSelect (y de cualquier panel anclado futuro): posiciona un
// panel teletransportado bajo su trigger (con flip hacia arriba si no cabe
// debajo), y centraliza el cierre por Escape/click-fuera usando la misma
// pila de capas que RgSheet (ver layerStack.ts) — así un panel abierto
// DENTRO de un sheet se come el primer Escape él solo, sin cerrar el sheet.
export function useFloatingPanel() {
  const triggerEl = ref<HTMLElement | null>(null)
  const panelEl = ref<HTMLElement | null>(null)
  const open = ref(false)
  const panelStyle = ref<Record<string, string>>({})
  const id = Symbol('floating-panel')

  function computePosition(assumedHeight: number) {
    const trigger = triggerEl.value
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const spaceAbove = rect.top
    const openAbove =
      spaceBelow < assumedHeight + VIEWPORT_MARGIN_PX && spaceAbove > spaceBelow

    panelStyle.value = {
      position: 'fixed',
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      ...(openAbove
        ? { bottom: `${window.innerHeight - rect.top}px` }
        : { top: `${rect.bottom}px` }),
    }
  }

  // usado tanto para el resize en marcha como para la segunda pasada tras
  // montar: si el panel ya está en el DOM, su alto MEDIDO manda; si no
  // (primerísimo cálculo), cae al de reserva
  function recomputePosition() {
    const measured = panelEl.value?.getBoundingClientRect().height
    computePosition(measured || FALLBACK_HEIGHT_PX)
  }

  // versión para listeners de scroll/resize: como mucho UNA por frame. Sin
  // esto, cada evento de scroll medía (getBoundingClientRect) y escribía
  // estilos — layout forzado a la cadencia del dedo mientras hay un panel
  // abierto.
  // el candado es `scheduled`, no el id del frame: con un rAF síncrono el id se
  // asignaría después de limpiarlo y esto se quedaría mudo (ver useVirtualRows)
  let scheduled = false
  let frame = 0
  function runRecompute() {
    scheduled = false
    if (open.value) recomputePosition()
  }

  function scheduleRecompute() {
    if (scheduled) return
    scheduled = true
    frame = requestAnimationFrame(runRecompute)
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    if (!isTopLayer(id)) return
    event.preventDefault()
    closePanel()
  }

  // pointerdown (no click): dispara antes que el click de una opción del
  // panel, así que si el target cae dentro del panel o del trigger, dejamos
  // que su propio manejador de click decida en vez de cerrar aquí primero y
  // perder ese click
  function onPointerDown(event: PointerEvent) {
    const target = event.target as Node
    if (triggerEl.value?.contains(target)) return
    if (panelEl.value?.contains(target)) return
    // un click FUERA también devuelve el foco al trigger (mismo destino que
    // Escape) para no perder el hilo del teclado tras cerrar
    closePanel()
    triggerEl.value?.focus()
  }

  function openPanel() {
    if (open.value) return
    computePosition(FALLBACK_HEIGHT_PX)
    open.value = true
    pushLayer(id)
    window.addEventListener('keydown', onKeydown)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', scheduleRecompute, { passive: true })
    // capture: los eventos scroll NO burbujean; en fase de captura llegan
    // también los de cualquier ancestro scrolleable (el <main> del shell,
    // sheets), así el panel sigue anclado a su trigger al hacer scroll.
    // passive: el handler nunca hace preventDefault, y así no entra en la
    // ruta crítica del scroll
    window.addEventListener('scroll', scheduleRecompute, { capture: true, passive: true })
    // el panel real recién se monta tras este tick (v-if acaba de latir):
    // recalcular con su alto MEDIDO corrige un flip que el de reserva
    // hubiera decidido mal
    nextTick(() => {
      if (!open.value) return // se cerró antes de que este tick llegara
      recomputePosition()
    })
  }

  function closePanel() {
    if (!open.value) return
    open.value = false
    popLayer(id)
    window.removeEventListener('keydown', onKeydown)
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('resize', scheduleRecompute)
    window.removeEventListener('scroll', scheduleRecompute, true)
    if (scheduled) {
      cancelAnimationFrame(frame)
      scheduled = false
    }
  }

  onBeforeUnmount(closePanel)

  return { triggerEl, panelEl, open, panelStyle, openPanel, closePanel }
}
