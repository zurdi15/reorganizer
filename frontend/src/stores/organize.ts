import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { ApiError } from '@/api/client'
import { cancelJob, createJob, executeJob, fetchJob, fetchJobs } from '@/api/jobs'
import { useInputStore } from '@/stores/input'
import { useJobsStore } from '@/stores/jobs'
import type {
  DuplicateStrategy,
  JobCreate,
  JobItem,
  JobRead,
  JobStatus,
  TransferMode,
} from '@/types/api'
import { toastApiError } from '@/utils/apiErrors'
import { isValidSegment, joinSegments, normalizeSegment } from '@/utils/path'

// Máquina de etapas del flujo Organizar. La etapa se DERIVA del job seguido
// (currentJobId) contra el job vivo del store de jobs (alimentado por WS):
//   compose → sin job seguido: componer destino sobre el input
//   plan    → el job seguido está planning|planned (el dry-run y su preview)
//   running → el job seguido está running
//   done    → seguimos un job que ya no está vivo (estado terminal)
// Estado local del store: los segmentos del path builder, las opciones
// elegidas (undefined = defaults del server) y la cache de items del plan.
export type OrganizeStage = 'compose' | 'plan' | 'running' | 'done'

export interface OrganizeOptions {
  transfer_mode?: TransferMode
  duplicate_strategy?: DuplicateStrategy
}

// orden de avance de un job: una respuesta HTTP nunca debe RETROCEDER el
// estado que el WS ya adelantó (la carrera clásica: el broadcast planned
// llega antes que el 202 del POST con status planning)
const STATUS_RANK: Record<JobStatus, number> = {
  planning: 0,
  planned: 1,
  running: 2,
  completed: 3,
  completed_with_errors: 3,
  cancelled: 3,
  failed: 3,
  interrupted: 3,
  discarded: 3,
}

const LIVE_STATUSES: readonly JobStatus[] = ['planning', 'planned', 'running']

// techo del backend para GET /jobs/{id}/items — un lote mayor no cabe en una
// preview razonable de todos modos
const PLAN_ITEMS_LIMIT = 2000

export const useOrganizeStore = defineStore('organize', () => {
  const jobs = useJobsStore()
  const input = useInputStore()

  // ---- composición del destino (estado puramente local) ----

  const destSegments = ref<string[]>([])
  const options = ref<OrganizeOptions>({})

  const destPath = computed(() => joinSegments(destSegments.value))

  // commit de un segmento tecleado: normaliza y valida (utils/path). Devuelve
  // false para que el builder pinte el error sin perder lo tecleado.
  function addSegment(raw: string): boolean {
    const segment = normalizeSegment(raw)
    if (!isValidSegment(segment)) return false
    destSegments.value.push(segment)
    return true
  }

  function removeSegment(index: number) {
    destSegments.value.splice(index, 1)
  }

  function removeLastSegment() {
    destSegments.value.pop()
  }

  // siembra desde una ruta completa (query ?dest= del historial, chip de
  // Recientes, adopción de un job vivo): se descartan los segmentos inválidos
  // en vez de rechazar la ruta entera
  function setFromPath(path: string) {
    destSegments.value = path.split('/').map(normalizeSegment).filter(isValidSegment)
  }

  // ---- job seguido ----

  const currentJobId = ref<number | null>(null)
  // última foto conocida del job seguido: cuando jobs.activeJob vuelve a null
  // (estado terminal), la etapa done sigue teniendo contadores que enseñar
  // mientras llega el fetch del estado final
  const jobSnapshot = ref<JobRead | null>(null)
  // job despedido con "Volver": el watcher de adopción no debe re-adoptarlo
  // (queda `planned` en el server hasta que el siguiente create lo descarte)
  const dismissedJobId = ref<number | null>(null)

  const creating = ref(false)
  const executing = ref(false)
  const cancelling = ref(false)
  // re-plan ENCOLADO: opciones cambiadas mientras un plan seguía en vuelo
  // (POST en curso o job en `planning`). Crear un job nuevo con el anterior
  // aún `planning` daría 409 job_already_active (ACTIVE_STATUSES del backend),
  // así que se espera a que aterrice en `planned` — donde el server ya lo
  // puede descartar — y se re-planifica entonces. Garantiza que el job
  // ejecutado refleje SIEMPRE las últimas opciones elegidas en la UI.
  const replanQueued = ref(false)

  const currentJob = computed<JobRead | null>(() => {
    const active = jobs.activeJob
    if (active && active.id === currentJobId.value) return active
    if (jobSnapshot.value && jobSnapshot.value.id === currentJobId.value) return jobSnapshot.value
    return null
  })

  const stage = computed<OrganizeStage>(() => {
    if (currentJobId.value === null) return 'compose'
    const active = jobs.activeJob
    if (active && active.id === currentJobId.value) {
      return active.status === 'running' ? 'running' : 'plan'
    }
    return 'done'
  })

  // ---- cache de items del plan (preview) ----

  const planItems = ref<JobItem[]>([])
  const planItemsLoading = ref(false)

  async function loadPlanItems(id: number): Promise<void> {
    planItemsLoading.value = true
    try {
      const items = await jobs.loadJobItems(id, { limit: PLAN_ITEMS_LIMIT })
      // guard de carrera: si el usuario ya re-planificó, esta respuesta es
      // del job viejo y se tira
      if (currentJobId.value === id) planItems.value = items
    } catch (error) {
      if (currentJobId.value === id) toastApiError(error)
    } finally {
      if (currentJobId.value === id) planItemsLoading.value = false
    }
  }

  // ---- integración de respuestas HTTP con el estado WS ----

  // aplica el JobRead de una respuesta HTTP sin pisar lo que el WS ya
  // adelantó (ver STATUS_RANK)
  function absorbJob(job: JobRead) {
    currentJobId.value = job.id
    const active = jobs.activeJob
    if (active && active.id === job.id) {
      if (STATUS_RANK[job.status] > STATUS_RANK[active.status]) {
        // un terminal descubierto por REST (WS ciego) también debe vaciar el
        // job vivo — el contrato del store de jobs: activeJob solo vivos
        if (LIVE_STATUSES.includes(job.status)) Object.assign(active, job)
        else jobs.activeJob = null
      }
    } else if (LIVE_STATUSES.includes(job.status)) {
      // job nuevo (re-plan: el anterior quedó descartado en el server) o WS
      // caído: la respuesta HTTP es la verdad disponible y REEMPLAZA al vivo
      jobs.activeJob = { ...job }
    }
    if (
      !jobSnapshot.value ||
      jobSnapshot.value.id !== job.id ||
      STATUS_RANK[job.status] >= STATUS_RANK[jobSnapshot.value.status]
    ) {
      jobSnapshot.value = { ...job }
    }
  }

  // 409 job_already_active con el WS ciego: recuperar el job vivo por REST y
  // aplicarlo como un state-sync sintético (solo si el store no lo tiene ya
  // — no se machaca un ring de eventos sano)
  async function syncActiveJob(): Promise<void> {
    try {
      const all = await fetchJobs()
      const live = all.find((job) => LIVE_STATUSES.includes(job.status))
      if (live && !jobs.activeJob) {
        jobs.applyWsMessage({ type: 'state-sync', data: { job: live, events: [] } })
      }
    } catch {
      // sin red no hay nada que sincronizar: el toast del 409 ya avisó
    }
  }

  // ---- acciones del ciclo de vida ----

  async function createPlan(): Promise<void> {
    const dest = destPath.value
    if (!dest || creating.value) return
    creating.value = true
    try {
      const payload: JobCreate = { dest_path: dest }
      if (options.value.transfer_mode) payload.transfer_mode = options.value.transfer_mode
      if (options.value.duplicate_strategy) {
        payload.duplicate_strategy = options.value.duplicate_strategy
      }
      const job = await createJob(payload)
      dismissedJobId.value = null
      planItems.value = []
      absorbJob(job)
      // carrera del broadcast `planned`: el planner commitea `planned` a la DB
      // ANTES de emitirlo, así que si ese mensaje WS se pierde (o llega y se
      // cae antes de instalarse), el job quedaría clavado en `planning` y la
      // etapa plan giraría sin fin. Una relectura REST acotada rescata el
      // estado en cuanto el POST vuelve todavía en `planning`.
      if (currentJob.value?.status === 'planning') void refreshCurrentJob()
    } catch (error) {
      // el plan no llegó a existir: cualquier re-plan encolado sobra
      replanQueued.value = false
      toastApiError(error)
      if (error instanceof ApiError && error.status === 409) await syncActiveJob()
    } finally {
      creating.value = false
    }
  }

  async function execute(): Promise<void> {
    const id = currentJobId.value
    if (id === null || executing.value) return
    executing.value = true
    try {
      absorbJob(await executeJob(id))
    } catch (error) {
      toastApiError(error)
      // 409 job_not_planned: otro cliente ejecutó/descartó el plan — re-leer
      // el job devuelve la verdad y la etapa se recoloca sola
      if (error instanceof ApiError && error.status === 409) await refreshCurrentJob()
    } finally {
      executing.value = false
    }
  }

  async function cancel(): Promise<void> {
    const id = currentJobId.value
    if (id === null || cancelling.value) return
    cancelling.value = true
    try {
      // cooperativa: el 202 no cambia el estado aún — el job-status
      // `cancelled` llegará por WS cuando el task pare entre items
      await cancelJob(id)
    } catch (error) {
      toastApiError(error)
    } finally {
      cancelling.value = false
    }
  }

  async function refreshCurrentJob(): Promise<void> {
    const id = currentJobId.value
    if (id === null) return
    try {
      const job = await fetchJob(id)
      if (currentJobId.value === id) absorbJob(job)
    } catch {
      // la foto local sigue valiendo; el próximo evento WS re-sincroniza
    }
  }

  // cambiar opciones con un plan en pie lo invalida: hay que re-planificar
  // para que el job ejecutado use las opciones nuevas (el backend descarta
  // solo el `planned` obsoleto). Si el plan sigue en vuelo (POST en curso o
  // job `planning`) no se puede crear otro todavía —daría 409—: se ENCOLA y
  // el watcher de `planned` lo dispara al aterrizar, sin perder el cambio.
  async function updateOptions(partial: OrganizeOptions): Promise<void> {
    options.value = { ...options.value, ...partial }
    const status = currentJob.value?.status
    if (creating.value || status === 'planning') {
      replanQueued.value = true
    } else if (status === 'planned') {
      await createPlan()
    }
  }

  // "Volver" desde la preview: dejar de seguir el plan (el server lo
  // descartará al crear el siguiente) y volver a componer sin perder segmentos
  function backToCompose() {
    dismissedJobId.value = currentJobId.value
    currentJobId.value = null
    jobSnapshot.value = null
    planItems.value = []
    replanQueued.value = false
  }

  // "Organizar más": suelta el job terminado y refresca el input (el job lo
  // vació o lo dejó con los fallos — la verdad está en el server)
  function reset() {
    currentJobId.value = null
    jobSnapshot.value = null
    dismissedJobId.value = null
    planItems.value = []
    options.value = {}
    replanQueued.value = false
    void input.refresh().catch(() => {
      // refresh de fondo sin vista que lo espere: no dejar rechazos huérfanos
    })
  }

  // ---- reacciones al estado WS ----

  // adopción automática: un job vivo que aparece sin que sigamos ninguno
  // (state-sync tras reload, u otro cliente) pasa a ser el actual — así la
  // vista aterriza directa en la etapa correcta. deep: también fotografía
  // cada mutación de contadores para que la etapa done tenga la última.
  watch(
    () => jobs.activeJob,
    (job) => {
      if (!job) return
      if (currentJobId.value === null) {
        if (job.id === dismissedJobId.value) return
        currentJobId.value = job.id
        setFromPath(job.dest_path)
      }
      if (job.id === currentJobId.value) jobSnapshot.value = { ...job }
    },
    { deep: true, immediate: true },
  )

  // el plan está listo → cargar sus items para la preview (una sola vez por
  // job: planned no re-entra). Si había un re-plan encolado (opciones
  // cambiadas mientras el plan estaba en vuelo), ahora que el job es
  // descartable se re-planifica con las últimas opciones EN VEZ de pintar la
  // preview de un plan ya obsoleto.
  watch(
    () => [currentJobId.value, currentJob.value?.status] as const,
    ([id, status]) => {
      if (status !== 'planned' || typeof id !== 'number') return
      if (replanQueued.value) {
        replanQueued.value = false
        void createPlan()
        return
      }
      void loadPlanItems(id)
    },
  )

  // al terminar (etapa done), pedir el estado final autoritativo: el WS de
  // job-status solo trae el status — contadores finales, error e
  // immich_status viven en GET /jobs/{id}
  watch(stage, (next) => {
    if (next === 'done') void refreshCurrentJob()
  })

  // el evento immich llega DESPUÉS del terminal (activeJob ya es null, el
  // store de jobs solo lo mete al ring): estamparlo en la foto local para
  // que el chip del panel done reaccione en vivo
  watch(
    () => jobs.events[jobs.events.length - 1],
    (last) => {
      if (!last || last.type !== 'immich') return
      if (jobSnapshot.value && last.data.job_id === jobSnapshot.value.id) {
        jobSnapshot.value.immich_status = last.data.status
      }
    },
  )

  return {
    // estado
    destSegments,
    options,
    destPath,
    stage,
    currentJobId,
    currentJob,
    planItems,
    planItemsLoading,
    creating,
    executing,
    cancelling,
    // composición
    addSegment,
    removeSegment,
    removeLastSegment,
    setFromPath,
    // ciclo de vida
    createPlan,
    execute,
    cancel,
    updateOptions,
    backToCompose,
    reset,
  }
})
