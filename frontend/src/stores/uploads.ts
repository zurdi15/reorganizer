import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, OfflineError } from '@/api/client'
import {
  deleteSession,
  type ResumeState,
  UploadAbortError,
  uploadFile,
  UploadSkippedError,
} from '@/api/uploads'
import { i18n } from '@/i18n'
import { useToastStore } from '@/stores/toast'

// Cola de subidas (fase 11, feature estrella). Agnóstica de vista: las
// subidas siguen en background al navegar y el slab CTA del nav muestra el
// lote (contrato del shell, abajo). Un archivo por request (progreso XHR
// real por archivo) con concurrencia 2: suficiente paralelismo para tapar
// la latencia sin saturar la radio del móvil.

export type UploadKind = 'image' | 'video' | 'other'
// `skipped`: ese nombre ya estaba en la bandeja y el ajuste de duplicados de
// subida es `skip` — estado TERMINAL y de éxito, no un error (sin reintento:
// volvería a saltarse; lo que cambia el resultado es el ajuste, en Ajustes)
export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled' | 'skipped'

export interface UploadItem {
  id: number
  file: File
  name: string
  size: number
  // de file.type (MIME del picker): decide miniatura vs icono
  kind: UploadKind
  status: UploadStatus
  // 0..1 sobre bytes reales (xhr.upload.onprogress)
  progress: number
  // slug i18n (errors.*) cuando status === 'error'
  errorSlug?: string
  // miniatura SOLO para imágenes (URL.createObjectURL, revocada al salir de
  // la lista); los vídeos van con icono + tamaño — extraer un frame en
  // cliente costaría decodificar el vídeo en el móvil para nada
  objectUrl?: string
  // lote del slab al que pertenece (ver beginBatchIfDrained)
  batch: number
}

export const UPLOAD_CONCURRENCY = 2

// Costura para el refresh del input al drenar la cola: el backend ya emite
// input-changed por WS al terminar cada upload, pero si el socket está caído
// el usuario vería un listado viejo — cinturón y tirantes. Import PEREZOSO:
// stores/input.ts lo escribe la oleada C3 en paralelo; así no hay
// acoplamiento de orden de carga y los tests lo reemplazan con vi.spyOn
// sobre este objeto sin necesitar que el módulo exista.
export const drainHooks = {
  async refreshInput(): Promise<void> {
    try {
      const { useInputStore } = await import('@/stores/input')
      await useInputStore().refresh()
    } catch {
      // el refresh falló (red, backend): no es fatal — el evento WS
      // input-changed sigue cubriendo el refresco del listado
    }
  },
}

let nextId = 1

function kindFor(file: File): UploadKind {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'other'
}

// cede el hilo entre tandas del enqueue: rAF si existe (se alinea con el paint),
// si no un timeout 0 (tests/entornos sin rAF)
function scheduleIdle(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fn())
  else setTimeout(fn, 0)
}

// throttle del progreso: xhr.upload.onprogress dispara decenas de veces por
// segundo; una barra no necesita más de ~12 fps, y así se recorta la reactividad
const PROGRESS_MIN_MS = 80

function slugFor(error: unknown): string {
  if (error instanceof OfflineError) return 'offline'
  if (error instanceof ApiError) return error.slug
  return 'generic'
}

export const useUploadsStore = defineStore('uploads', () => {
  const items = ref<UploadItem[]>([])

  // ---- CONTRATO DEL SHELL (slab CTA del nav) — conservar tal cual ----
  //   active: hay subidas en curso (queued/uploading)
  //   done/total: progreso del LOTE actual (se resetean al arrancar un lote
  //   nuevo tras un drenado)
  //   skipped: archivos del lote que ya estaban en la bandeja. Fuera de
  //   `done` a propósito (nada se subió), pero cuentan como resueltos: el
  //   badge del nav suma `processed` para no quedarse clavado en 2/5
  const active = ref(false)
  const done = ref(0)
  const total = ref(0)
  const skipped = ref(0)
  const processed = computed(() => done.value + skipped.value)

  // abort() de las subidas en vuelo, por id — funciones fuera del estado
  // reactivo (no son datos, no deben proxificarse ni serializarse)
  const aborts = new Map<number, () => void>()

  // estado de reanudación por item (uploadId + received): un retry CONTINÚA la
  // subida por trozos desde donde iba, no la reempieza (clave con GB en juego).
  // Fuera del estado reactivo: lo muta el api en cada trozo.
  const resumes = new Map<number, ResumeState>()

  function resumeFor(id: number): ResumeState {
    let state = resumes.get(id)
    if (!state) {
      state = {}
      resumes.set(id, state)
    }
    return state
  }

  // nº de lote: un lote nuevo empieza en el primer enqueue/retry tras un
  // drenado; los items llevan su nº para saber si cuentan en el slab actual
  let batchSeq = 0

  function beginBatchIfDrained() {
    if (active.value) return
    batchSeq++
    done.value = 0
    total.value = 0
    skipped.value = 0
    active.value = true
  }

  // suma el item al lote actual si aún no está contado (retry de un item de
  // un lote anterior mientras corre uno nuevo: el slab no debe descuadrarse)
  function joinBatch(item: UploadItem) {
    if (item.batch === batchSeq) return
    item.batch = batchSeq
    total.value++
  }

  function releaseObjectUrl(item: UploadItem) {
    if (!item.objectUrl) return
    URL.revokeObjectURL(item.objectUrl)
    item.objectUrl = undefined
  }

  // fuente única (picker, drag&drop, y en v1.1 Web Share Target): File[].
  // Empuja por TANDAS cediendo el hilo entre ellas: seleccionar cientos/miles
  // de ficheros ya no congela la UI (el freeze de "se queda pillado" al elegir
  // en el móvil). El total del lote se cuenta de una para que el slab lo
  // muestre completo desde el primer instante.
  function enqueue(files: File[] | FileList) {
    const list = Array.from(files)
    if (list.length === 0) return
    beginBatchIfDrained()
    total.value += list.length
    let i = 0
    const CHUNK = 50

    function pushChunk() {
      const end = Math.min(i + CHUNK, list.length)
      for (; i < end; i++) {
        const file = list[i]
        const item: UploadItem = {
          id: nextId++,
          file,
          name: file.name,
          size: file.size,
          kind: kindFor(file),
          status: 'queued',
          progress: 0,
          batch: batchSeq,
        }
        if (item.kind === 'image') item.objectUrl = URL.createObjectURL(file)
        items.value.push(item)
      }
      pump() // arranca subidas en cuanto hay items (no espera a toda la tanda)
      if (i < list.length) scheduleIdle(pushChunk)
    }
    pushChunk()
  }

  // arranca subidas hasta llenar la concurrencia — idempotente: se llama en
  // cada settle y al volver a foreground (visibilitychange)
  function pump() {
    let inFlight = items.value.filter((i) => i.status === 'uploading').length
    for (const item of items.value) {
      if (inFlight >= UPLOAD_CONCURRENCY) break
      if (item.status !== 'queued') continue
      start(item)
      inFlight++
    }
  }

  function markSkipped(item: UploadItem) {
    item.status = 'skipped'
    item.progress = 1
    item.errorSlug = undefined
    skipped.value++
    resumes.delete(item.id)
  }

  function start(item: UploadItem) {
    item.status = 'uploading'
    // no se resetea progress: en un retry se reanuda desde el % ya subido
    let lastTs = 0
    const { promise, abort } = uploadFile(item.file, {
      resume: resumeFor(item.id),
      onProgress: (fraction) => {
        // throttle: aplica como mucho ~12 veces/seg, pero SIEMPRE el 1 final
        // (que la barra llegue a tope) para no dejarla congelada a medias
        const now = Date.now()
        if (fraction < 1 && now - lastTs < PROGRESS_MIN_MS) return
        lastTs = now
        item.progress = fraction
      },
    })
    aborts.set(item.id, abort)
    promise
      .then((results) => {
        // el server puede haber saltado el archivo al finalizar (otra subida
        // ganó la carrera con ese mismo nombre): el resultado lo dice
        if (results?.[0]?.status === 'skipped') {
          markSkipped(item)
          return
        }
        item.status = 'done'
        item.progress = 1
        done.value++
        resumes.delete(item.id) // sesión ya consumida por complete
      })
      .catch((error: unknown) => {
        // cancel() marca ANTES de abortar; el rechazo del XHR llega después
        // y aquí se respeta — un abort jamás se disfraza de error
        if (item.status === 'canceled' || error instanceof UploadAbortError) {
          item.status = 'canceled'
        } else if (error instanceof UploadSkippedError) {
          // ni se abrió sesión: el nombre ya estaba en la bandeja
          markSkipped(item)
        } else {
          // se CONSERVA la sesión (resumes) para reanudar en el retry
          item.status = 'error'
          item.errorSlug = slugFor(error)
        }
      })
      .finally(() => {
        aborts.delete(item.id)
        pump()
        checkDrain()
      })
  }

  function checkDrain() {
    if (!active.value) return
    const busy = items.value.some((i) => i.status === 'queued' || i.status === 'uploading')
    if (busy) return
    active.value = false
    if (done.value > 0) {
      // el lote subió algo: refresh del input (ver drainHooks) + toast ok
      void drainHooks.refreshInput()
      useToastStore().push(
        'ok',
        i18n.global.t('upload.toastDone', { n: done.value }, done.value),
      )
    }
    if (skipped.value > 0) {
      // aviso aparte (y no de error): los saltados no cambiaron la bandeja,
      // pero el usuario tiene que enterarse de que no se subieron
      useToastStore().push(
        'info',
        i18n.global.t('upload.toastSkipped', { n: skipped.value }, skipped.value),
      )
    }
  }

  function retry(id: number) {
    const item = items.value.find((i) => i.id === id)
    if (!item || (item.status !== 'error' && item.status !== 'canceled')) return
    beginBatchIfDrained()
    joinBatch(item)
    item.status = 'queued'
    // no se resetea progress: el retry REANUDA desde el % ya subido
    item.errorSlug = undefined
    pump()
  }

  function retryFailed() {
    for (const item of items.value.filter((i) => i.status === 'error')) retry(item.id)
  }

  // libera la sesión de subida por trozos en el servidor (su .part, que con
  // varios GB pesa) y olvida su estado de reanudación
  function dropSession(id: number) {
    const state = resumes.get(id)
    if (state?.uploadId) deleteSession(state.uploadId)
    resumes.delete(id)
  }

  function cancel(id: number) {
    const index = items.value.findIndex((i) => i.id === id)
    if (index === -1) return
    const item = items.value[index]
    if (item.status === 'queued') {
      // nunca llegó a la red: fuera de la lista y su hueco del contador del
      // lote se devuelve (el slab no muestra fantasmas)
      dropSession(id)
      releaseObjectUrl(item)
      items.value.splice(index, 1)
      if (item.batch === batchSeq && total.value > 0) total.value--
      checkDrain()
    } else if (item.status === 'uploading') {
      // marcar ANTES de abortar (ver el catch de start)
      item.status = 'canceled'
      aborts.get(id)?.()
      dropSession(id)
    }
  }

  // acción de conjunto del resumen: suelta todo lo que aún no salió;
  // lo que está en vuelo conserva su cancel individual
  function cancelPending() {
    for (const item of items.value.filter((i) => i.status === 'queued')) cancel(item.id)
  }

  // limpia SOLO lo terminado-bien (done/skipped) y lo cancelado a propósito.
  // Los fallidos (error) se QUEDAN: son justo lo que el usuario quiere
  // reintentar, no lo que quiere barrer. No toca done/total: son la foto del
  // LOTE.
  function clearFinished() {
    const keep: UploadItem[] = []
    for (const item of items.value) {
      if (item.status === 'done' || item.status === 'canceled' || item.status === 'skipped') {
        releaseObjectUrl(item)
        resumes.delete(item.id)
      } else {
        keep.push(item)
      }
    }
    items.value = keep
  }

  // contadores derivados para el resumen ("3 subiendo · 12 en cola · …")
  const stats = computed(() => {
    const s = { queued: 0, uploading: 0, done: 0, error: 0, canceled: 0, skipped: 0 }
    for (const item of items.value) s[item.status]++
    return s
  })

  // iOS suspende los XHR al pasar a background: los interrumpidos aparecen
  // como error de RED (offline) al rechazarse su promesa. Al VOLVER a
  // foreground se auto-reanudan (su sesión por trozos sigue viva: continúan
  // desde received, sin re-subir los GB ya enviados) y se re-bombea la cola.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    for (const item of items.value) {
      if (item.status === 'error' && item.errorSlug === 'offline') {
        beginBatchIfDrained()
        joinBatch(item)
        item.status = 'queued'
        item.errorSlug = undefined
      }
    }
    pump()
  })

  return {
    items,
    active,
    done,
    total,
    skipped,
    processed,
    stats,
    enqueue,
    pump,
    retry,
    retryFailed,
    cancel,
    cancelPending,
    clearFinished,
  }
})
