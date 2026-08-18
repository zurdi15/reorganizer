import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  deleteInputFile,
  fetchInputDates,
  fetchInputFiles,
  fetchInputSummary,
} from '@/api/input'
import type { InputDates, InputFile, InputSummary } from '@/types/api'

// tamaño de página del listado: la grid arranca con esta primera tanda y el
// scroll infinito va apilando páginas de PAGE_SIZE en PAGE_SIZE. El folder
// puede tener miles de archivos — jamás se traen todos de golpe.
const PAGE_SIZE = 200

// throttle del relistado disparado por WS input-changed: subir muchos ficheros
// emite un input-changed por cada uno; sin esto serían cientos de refetch
const REFRESH_THROTTLE_MS = 1500

// Estado del folder de entrada: listado PAGINADO + contadores + sugerencias
// EXIF. La verdad vive en el server (LAN, sin capa offline): refresh() recarga
// la página 1 y los contadores/fechas a la vez y deduplica llamadas en vuelo —
// la grid, el evento WS input-changed y el drenado de subidas pueden pedirlo
// casi simultáneamente sin triplicar peticiones.
export const useInputStore = defineStore('input', () => {
  // acumula las páginas cargadas (append en loadMore); refresh() lo resetea
  const files = ref<InputFile[]>([])
  // total REAL del folder (del server), no files.length — la cabecera y
  // hasMore se apoyan en él aunque solo haya cargado una página
  const total = ref(0)
  const summary = ref<InputSummary | null>(null)
  const dates = ref<InputDates | null>(null)
  const loading = ref(false)
  // cargando la página SIGUIENTE (scroll infinito), distinto de loading (que
  // es el primer load / el refresh a página 1)
  const loadingMore = ref(false)
  // primer load completado (con éxito o no): la grid distingue "cargando"
  // de "vacío de verdad" sin flashear el estado vacío antes de tiempo
  const loaded = ref(false)

  // ¿quedan páginas por traer? la grid solo arma el sentinel de scroll si sí
  const hasMore = computed(() => files.value.length < total.value)

  // promesa compartida del refresh en vuelo — el deduplicador
  let inflight: Promise<void> | null = null

  function refresh(): Promise<void> {
    // requeue-aware: si ya hay una ronda en vuelo, el nuevo caller (p.ej. un
    // input-changed que llega a mitad de fetch) no puede compartirla sin más —
    // esos datos ya son viejos. Se encadena UNA ronda fresca tras la actual;
    // el finally nulifica inflight ANTES de este .then, así que el refresh()
    // encadenado arranca una petición nueva (y no hay bucle: solo un eslabón).
    if (inflight) return inflight.catch(() => {}).then(() => refresh())
    loading.value = true
    inflight = Promise.all([
      fetchInputFiles({ limit: PAGE_SIZE, offset: 0 }),
      fetchInputSummary(),
      fetchInputDates(),
    ])
      .then(([page, nextSummary, nextDates]) => {
        // reset a la página 1: se REEMPLAZA lo acumulado, no se apila
        files.value = page.files
        total.value = page.total
        summary.value = nextSummary
        dates.value = nextDates
      })
      .finally(() => {
        inflight = null
        loading.value = false
        loaded.value = true
      })
    return inflight
  }

  // scroll infinito: trae la página siguiente (offset = lo ya cargado) y la
  // APILA — sin recargar ni perder la posición del scroll. No-op si ya no
  // quedan páginas o si hay otra en vuelo (el sentinel puede dispararse varias
  // veces seguidas): el guard mata la doble llamada concurrente.
  async function loadMore(): Promise<void> {
    if (loadingMore.value || !hasMore.value) return
    loadingMore.value = true
    try {
      const page = await fetchInputFiles({ limit: PAGE_SIZE, offset: files.value.length })
      files.value = [...files.value, ...page.files]
      total.value = page.total
    } finally {
      loadingMore.value = false
    }
  }

  // borrar un archivo del input (basura detectada en la sheet de detalle):
  // DELETE y luego se quita ese archivo de la lista EN LOCAL + se decrementa
  // total — más barato que un refresh completo y conserva el scroll. El
  // summary sí se recarga (los badges de la cabecera deben cuadrar).
  async function removeFile(path: string): Promise<void> {
    await deleteInputFile(path)
    const before = files.value.length
    files.value = files.value.filter((file) => file.path !== path)
    if (files.value.length < before) total.value = Math.max(0, total.value - 1)
    summary.value = await fetchInputSummary()
  }

  // evento WS input-changed (fin de uploads y de jobs): los counts llegan en
  // el propio mensaje — se aplican al INSTANTE (banda/badges reaccionan ya). El
  // relistado a la página 1 va THROTTLED: input-changed se emite por CADA
  // archivo subido, y subir 500 no debe disparar 500 refetch. Se refresca al
  // instante en el primero y como mucho cada REFRESH_THROTTLE_MS, con una ronda
  // final para reflejar el estado ya asentado.
  let lastRefresh = 0
  let trailing: ReturnType<typeof setTimeout> | null = null

  function throttledRefresh() {
    const since = Date.now() - lastRefresh
    if (since >= REFRESH_THROTTLE_MS) {
      lastRefresh = Date.now()
      void refresh().catch(() => {})
    } else if (!trailing) {
      trailing = setTimeout(() => {
        trailing = null
        lastRefresh = Date.now()
        void refresh().catch(() => {})
      }, REFRESH_THROTTLE_MS - since)
    }
  }

  function applyInputChanged(counts: InputSummary) {
    summary.value = counts
    throttledRefresh()
  }

  // ---- sugerencias EXIF para el path builder (chips de oleada 4) ----

  // años con fotos en el lote, de más reciente a más antiguo (el chip más
  // probable primero). Llegan como string del backend → orden numérico
  // explícito, no lexicográfico
  const suggestedYears = computed(() =>
    dates.value ? [...dates.value.years].sort((a, b) => Number(b) - Number(a)) : [],
  )

  // meses detectados para un año dado, ordenados ascendente. Claves y valores
  // llegan como string zero-padded ("08"): JSON no tiene claves numéricas y el
  // backend mantiene el formato de carpeta → orden numérico explícito
  function monthsForYear(year: string): string[] {
    const months = dates.value?.months_by_year[year] ?? []
    return [...months].sort((a, b) => Number(a) - Number(b))
  }

  return {
    files,
    total,
    summary,
    dates,
    loading,
    loadingMore,
    loaded,
    hasMore,
    suggestedYears,
    monthsForYear,
    refresh,
    loadMore,
    removeFile,
    applyInputChanged,
  }
})
