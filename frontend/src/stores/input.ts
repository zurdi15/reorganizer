import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  deleteInputFile,
  fetchInputDates,
  fetchInputFiles,
  fetchInputSummary,
} from '@/api/input'
import type { InputDates, InputFile, InputSummary } from '@/types/api'

// Estado del folder de entrada: listado + contadores + sugerencias EXIF.
// La verdad vive en el server (LAN, sin capa offline): refresh() recarga
// las tres lecturas a la vez y deduplica llamadas en vuelo — la grid, el
// evento WS input-changed y el drenado de subidas pueden pedirlo casi
// simultáneamente sin triplicar peticiones.
export const useInputStore = defineStore('input', () => {
  const files = ref<InputFile[]>([])
  const summary = ref<InputSummary | null>(null)
  const dates = ref<InputDates | null>(null)
  const loading = ref(false)
  // primer load completado (con éxito o no): la grid distingue "cargando"
  // de "vacío de verdad" sin flashear el estado vacío antes de tiempo
  const loaded = ref(false)

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
    inflight = Promise.all([fetchInputFiles(), fetchInputSummary(), fetchInputDates()])
      .then(([nextFiles, nextSummary, nextDates]) => {
        files.value = nextFiles
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

  // borrar un archivo del input (basura detectada en la sheet de detalle):
  // DELETE y después recarga completa — los contadores y las sugerencias
  // EXIF pueden haber cambiado, no solo el listado
  async function removeFile(path: string): Promise<void> {
    await deleteInputFile(path)
    await refresh()
  }

  // evento WS input-changed (fin de uploads y de jobs): los counts llegan en
  // el propio mensaje — se aplican al instante (la banda/badges reaccionan
  // ya) y el listado se recarga deduplicado detrás
  function applyInputChanged(counts: InputSummary) {
    summary.value = counts
    void refresh().catch(() => {
      // el refresh de fondo no tiene vista que lo espere: un fallo aquí no
      // debe ser una promesa rechazada sin dueño — el usuario sigue viendo
      // los counts del mensaje y el próximo refresh manual lo reintenta
    })
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
    summary,
    dates,
    loading,
    loaded,
    suggestedYears,
    monthsForYear,
    refresh,
    removeFile,
    applyInputChanged,
  }
})
