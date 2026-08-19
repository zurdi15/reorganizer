import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

// Ventana de render para listas largas (la cola de subidas): solo se montan
// las filas que caen en el viewport más un margen, y el hueco de las que NO se
// montan se compensa con padding arriba y abajo — así el alto total, la barra
// de scroll y la posición del dedo siguen siendo los de la lista completa.
//
// Por qué hace falta si ya hay `content-visibility`: CV ahorra layout y paint
// de lo que está fuera de pantalla, pero NO ahorra crear el componente Vue ni
// sus nodos DOM. Con 2000 archivos eso es lo caro (y lo que se queda en
// memoria); aquí se montan ~20 pase lo que pase.
//
// EXIGE filas de alto uniforme: la cola lo garantiza por construcción (fila de
// alto fijo, ver ROW_HEIGHT_PX y UploadQueueItem).

export interface VirtualRowsOptions {
  // alto de cada fila en px, bordes incluidos. Es la ESTIMACIÓN inicial: en
  // cuanto hay una fila pintada se mide de verdad y manda la medida (las
  // alturas de Tailwind van en rem, así que con otro tamaño de fuente base
  // una fila de "72px" mide otra cosa y la cuenta se desalinearía)
  rowHeight: number
  // filas de más por arriba y por abajo: absorben el scroll rápido sin que
  // aparezcan huecos en blanco antes de que el siguiente frame monte nada
  overscan?: number
  // por debajo de este número no compensa: se renderiza la lista entera (y así
  // las listas normales se comportan exactamente igual que antes)
  threshold?: number
}

// ¿quién scrollea de verdad? En esta app es el <main> del shell, pero el
// composable no lo da por hecho: sube por el árbol buscando el primer ancestro
// con overflow-y auto|scroll y, si no hay ninguno, usa el viewport.
function findScroller(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
    node = node.parentElement
  }
  return null
}

export function useVirtualRows(count: Ref<number>, options: VirtualRowsOptions) {
  const { overscan = 6, threshold = 60 } = options
  // alto de fila vigente: arranca con la estimación y se corrige con la
  // medida real de la primera fila montada
  const rowHeight = ref(options.rowHeight)

  // el elemento de la lista (ref de plantilla): de su posición sale la ventana
  const listEl = ref<HTMLElement | null>(null)
  const start = ref(0)
  const end = ref(0)

  const virtual = computed(() => count.value > threshold)
  const padTop = computed(() => (virtual.value ? start.value * rowHeight.value : 0))
  const padBottom = computed(() =>
    virtual.value ? Math.max(0, count.value - end.value) * rowHeight.value : 0,
  )

  let scroller: HTMLElement | null = null
  let scheduled = false
  let frame = 0

  function measure() {
    if (!virtual.value) {
      start.value = 0
      end.value = count.value
      return
    }
    const el = listEl.value
    if (!el) return
    // alto REAL de una fila (rem, zoom, tipografía del usuario): si hay filas
    // pintadas manda lo medido, no la estimación de la opción
    const firstRow = el.firstElementChild
    const measured = firstRow ? firstRow.getBoundingClientRect().height : 0
    if (measured > 0 && measured !== rowHeight.value) rowHeight.value = measured
    // rect.top es el borde SUPERIOR de la lista y no se mueve al cambiar el
    // padding (el padding va por dentro): la cuenta se mantiene coherente
    const top = el.getBoundingClientRect().top
    const viewTop = scroller ? scroller.getBoundingClientRect().top : 0
    const viewHeight = scroller ? scroller.clientHeight : window.innerHeight
    // px de lista que ya han pasado por encima del borde del scroller
    const scrolled = viewTop - top
    const first = Math.floor(scrolled / rowHeight.value) - overscan
    const visible = Math.ceil(viewHeight / rowHeight.value) + overscan * 2
    start.value = Math.min(Math.max(0, first), Math.max(0, count.value - 1))
    end.value = Math.min(count.value, start.value + visible)
  }

  // un recálculo por frame como mucho: el scroll dispara decenas de eventos
  // por segundo y cada medición lee layout. El candado es `scheduled` y no el
  // id del frame: si requestAnimationFrame ejecutara el callback de forma
  // síncrona, el id se asignaría DESPUÉS de limpiarlo y el composable se
  // quedaría mudo para siempre.
  function runMeasure() {
    scheduled = false
    measure()
  }

  function schedule() {
    if (scheduled) return
    scheduled = true
    frame = requestAnimationFrame(runMeasure)
  }

  // el scroller se resuelve CADA VEZ que aparece la lista, no solo al montar:
  // la cola vive tras un v-if (no existe hasta el primer archivo), así que al
  // montarse la vista todavía no hay elemento del que subir buscándolo
  let listening: EventTarget | null = null

  function attach() {
    detach()
    scroller = findScroller(listEl.value)
    listening = scroller ?? window
    listening.addEventListener('scroll', schedule, { passive: true })
  }

  function detach() {
    listening?.removeEventListener('scroll', schedule)
    listening = null
  }

  watch(
    listEl,
    (el) => {
      if (!el) {
        detach()
        return
      }
      attach()
      measure()
    },
    // post: el elemento tiene que estar YA en el DOM para medirlo y para que
    // getComputedStyle de sus ancestros diga la verdad
    { flush: 'post' },
  )

  onMounted(() => {
    window.addEventListener('resize', schedule, { passive: true })
    if (listEl.value) {
      attach()
      measure()
    }
  })

  onBeforeUnmount(() => {
    detach()
    window.removeEventListener('resize', schedule)
    if (scheduled) cancelAnimationFrame(frame)
    scheduled = false
  })

  // la lista crece (se encolan más ficheros) o se encoge (limpiar terminados):
  // la ventana se recalcula sin esperar a que el usuario toque el scroll.
  // post, otra vez: las filas nuevas ya están pintadas cuando se mide.
  watch(count, measure, { flush: 'post' })

  return { listEl, start, end, padTop, padBottom, virtual, rowHeight, measure }
}
