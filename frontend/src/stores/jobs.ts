import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fetchJob, fetchJobItems, fetchJobs } from '@/api/jobs'
import type { JobItem, JobItemStatus, JobRead, JobStatus, WsMessage } from '@/types/api'

// Job activo + progreso en vivo alimentado por WebSocket (fase 10) +
// historial persistente. CONTRATO heredado del stub de oleada 1 que el shell
// ya consume (ActiveJobBand):
//   activeJob: JobRead | null — job vivo (planning/planned/running), null si no hay
//
// El ring de eventos guarda los mensajes WS TAL CUAL (JSON plano, jamás
// HTML): quien los pinte (JobProgressPanel, oleada 4) los renderiza SIEMPRE
// como nodos de texto — los nombres de archivo vienen del usuario y son
// hostiles por definición (el XSS del Reorganizer viejo).

// cap del log en cliente (el ring del server es 300; aquí 200 por plan:
// suficiente para el panel de progreso sin engordar la memoria del tab)
const EVENTS_CAP = 200

// estados con job "vivo" — fuera de estos, activeJob vuelve a null y la
// banda del shell desaparece
const ACTIVE_STATUSES: readonly JobStatus[] = ['planning', 'planned', 'running']

// solo estos tipos alimentan el ring (log por archivo + fallos + Immich);
// job-status/plan-progress son estado, no líneas de log, e input-changed
// pertenece al store de input
type RingMessage = Extract<WsMessage, { type: 'item-done' | 'job-error' | 'immich' }>
const RING_TYPES: ReadonlySet<string> = new Set(['item-done', 'job-error', 'immich'])

function isRingMessage(message: WsMessage): message is RingMessage {
  return RING_TYPES.has(message.type)
}

export const useJobsStore = defineStore('jobs', () => {
  const activeJob = ref<JobRead | null>(null)
  // progreso de la fase de planificación (scanned/total del plan-progress) —
  // los counters de JobRead son de EJECUCIÓN y no se contaminan con esto
  const planProgress = ref<{ scanned: number; total: number } | null>(null)
  const events = ref<RingMessage[]>([])

  const history = ref<JobRead[]>([])
  const historyLoading = ref(false)

  // ---- aplicación de mensajes WS (dispatch tipado desde useWebSocket) ----

  function pushEvent(message: RingMessage) {
    events.value.push(message)
    if (events.value.length > EVENTS_CAP) {
      events.value.splice(0, events.value.length - EVENTS_CAP)
    }
  }

  function setActiveJob(job: JobRead | null) {
    activeJob.value = job && ACTIVE_STATUSES.includes(job.status) ? job : null
    if (!activeJob.value) planProgress.value = null
  }

  // dedupe de la recuperación: id del job cuyo fetch REST está en vuelo. Evita
  // que una ráfaga de job-status del mismo job desconocido dispare fetchs en
  // tromba (un solo GET por id mientras el anterior no vuelve).
  let recoveringJobId: number | null = null

  // job-status de un job que este cliente no conoce (arrancado en otra
  // pestaña/dispositivo) y que sigue VIVO: lo trae por REST y lo adopta si al
  // volver la red sigue activo. Best-effort: sin vista que espere el fallo.
  async function recoverJob(jobId: number): Promise<void> {
    if (recoveringJobId === jobId) return
    recoveringJobId = jobId
    try {
      const job = await fetchJob(jobId)
      if (ACTIVE_STATUSES.includes(job.status)) setActiveJob(job)
    } catch {
      // recuperación oportunista: un fallo aquí no debe romper el dispatch WS
    } finally {
      if (recoveringJobId === jobId) recoveringJobId = null
    }
  }

  function applyWsMessage(message: WsMessage) {
    switch (message.type) {
      case 'state-sync': {
        // restauración completa tras (re)conectar: job + replay del ring del
        // server. Se filtra a los tipos de log (el replay puede traer
        // job-status/input-changed históricos que aquí no aportan) y se
        // recorta al cap ANTES de asignar.
        setActiveJob(message.data.job)
        events.value = message.data.events.filter(isRingMessage).slice(-EVENTS_CAP)
        // si el job sigue planificando, el último plan-progress del replay
        // restaura la barra (sin esto, un reload a mitad de plan la deja a 0
        // hasta el siguiente tick del server)
        if (activeJob.value?.status === 'planning') {
          // bucle inverso a mano: findLast es ES2023 y el target es ES2022
          for (let i = message.data.events.length - 1; i >= 0; i--) {
            const event = message.data.events[i]
            if (event.type === 'plan-progress' && event.data.job_id === activeJob.value.id) {
              planProgress.value = { scanned: event.data.scanned, total: event.data.total }
              break
            }
          }
        }
        break
      }
      case 'job-status': {
        const job = activeJob.value
        if (job && job.id === message.data.job_id) {
          job.status = message.data.status
          if (!ACTIVE_STATUSES.includes(job.status)) setActiveJob(null)
          else if (job.status !== 'planning') planProgress.value = null
        } else if (ACTIVE_STATUSES.includes(message.data.status)) {
          // no lo conocíamos (activeJob null o de otro id) pero sigue vivo →
          // recuperarlo por REST y adoptarlo (segunda pestaña/dispositivo)
          void recoverJob(message.data.job_id)
        }
        break
      }
      case 'plan-progress': {
        if (activeJob.value?.id === message.data.job_id) {
          planProgress.value = { scanned: message.data.scanned, total: message.data.total }
        }
        break
      }
      case 'item-done': {
        const job = activeJob.value
        if (job && job.id === message.data.job_id) {
          // los counters del mensaje vienen ANIDADOS; JobRead los lleva
          // PLANOS (contrato pydantic del backend) — se aplican campo a campo
          const counters = message.data.counters
          job.done = counters.done
          job.errors = counters.errors
          job.skipped = counters.skipped
          job.total = counters.total
        }
        pushEvent(message)
        break
      }
      case 'job-error': {
        pushEvent(message)
        break
      }
      case 'immich': {
        if (activeJob.value?.id === message.data.job_id) {
          activeJob.value.immich_status = message.data.status
        }
        pushEvent(message)
        break
      }
      // input-changed y tipos futuros: no son de este store
      default:
        break
    }
  }

  // ---- historial (backend de jobs en construcción concurrente: wrappers
  // finos sobre api/jobs.ts, probados con fetch mockeado) ----

  async function loadHistory(): Promise<void> {
    historyLoading.value = true
    try {
      history.value = await fetchJobs()
    } finally {
      historyLoading.value = false
    }
  }

  function loadJobItems(
    id: number,
    params?: { limit?: number; offset?: number; status?: JobItemStatus },
  ): Promise<JobItem[]> {
    return fetchJobItems(id, params)
  }

  // últimas 3 rutas de destino DISTINTAS (chips "Recientes" del
  // DestinationBuilder, oleada 4) — el historial llega del server ordenado
  // por más reciente primero
  const lastDestPaths = computed(() => {
    const seen = new Set<string>()
    const paths: string[] = []
    for (const job of history.value) {
      if (seen.has(job.dest_path)) continue
      seen.add(job.dest_path)
      paths.push(job.dest_path)
      if (paths.length === 3) break
    }
    return paths
  })

  return {
    activeJob,
    planProgress,
    events,
    history,
    historyLoading,
    lastDestPaths,
    applyWsMessage,
    loadHistory,
    loadJobItems,
  }
})
