import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { ApiError, OfflineError } from '@/api/client'
import { UploadAbortError, uploadFile } from '@/api/uploads'
import { i18n } from '@/i18n'
import { useToastStore } from '@/stores/toast'

// Cola de subidas (fase 11, feature estrella). Agnóstica de vista: las
// subidas siguen en background al navegar y el slab CTA del nav muestra el
// lote (contrato del shell, abajo). Un archivo por request (progreso XHR
// real por archivo) con concurrencia 2: suficiente paralelismo para tapar
// la latencia sin saturar la radio del móvil.

export type UploadKind = 'image' | 'video' | 'other'
export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled'

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
  const active = ref(false)
  const done = ref(0)
  const total = ref(0)

  // abort() de las subidas en vuelo, por id — funciones fuera del estado
  // reactivo (no son datos, no deben proxificarse ni serializarse)
  const aborts = new Map<number, () => void>()

  // nº de lote: un lote nuevo empieza en el primer enqueue/retry tras un
  // drenado; los items llevan su nº para saber si cuentan en el slab actual
  let batchSeq = 0

  function beginBatchIfDrained() {
    if (active.value) return
    batchSeq++
    done.value = 0
    total.value = 0
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

  // fuente única (picker, drag&drop, y en v1.1 Web Share Target): File[]
  function enqueue(files: File[] | FileList) {
    const list = Array.from(files)
    if (list.length === 0) return
    beginBatchIfDrained()
    for (const file of list) {
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
      total.value++
      items.value.push(item)
    }
    pump()
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

  function start(item: UploadItem) {
    item.status = 'uploading'
    item.progress = 0
    const { promise, abort } = uploadFile(item.file, {
      onProgress: (fraction) => {
        item.progress = fraction
      },
    })
    aborts.set(item.id, abort)
    promise
      .then(() => {
        item.status = 'done'
        item.progress = 1
        done.value++
      })
      .catch((error: unknown) => {
        // cancel() marca ANTES de abortar; el rechazo del XHR llega después
        // y aquí se respeta — un abort jamás se disfraza de error
        if (item.status === 'canceled' || error instanceof UploadAbortError) {
          item.status = 'canceled'
        } else {
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
  }

  function retry(id: number) {
    const item = items.value.find((i) => i.id === id)
    if (!item || (item.status !== 'error' && item.status !== 'canceled')) return
    beginBatchIfDrained()
    joinBatch(item)
    item.status = 'queued'
    item.progress = 0
    item.errorSlug = undefined
    pump()
  }

  function retryFailed() {
    for (const item of items.value.filter((i) => i.status === 'error')) retry(item.id)
  }

  function cancel(id: number) {
    const index = items.value.findIndex((i) => i.id === id)
    if (index === -1) return
    const item = items.value[index]
    if (item.status === 'queued') {
      // nunca llegó a la red: fuera de la lista y su hueco del contador del
      // lote se devuelve (el slab no muestra fantasmas)
      releaseObjectUrl(item)
      items.value.splice(index, 1)
      if (item.batch === batchSeq && total.value > 0) total.value--
      checkDrain()
    } else if (item.status === 'uploading') {
      // marcar ANTES de abortar (ver el catch de start)
      item.status = 'canceled'
      aborts.get(id)?.()
    }
  }

  // acción de conjunto del resumen: suelta todo lo que aún no salió;
  // lo que está en vuelo conserva su cancel individual
  function cancelPending() {
    for (const item of items.value.filter((i) => i.status === 'queued')) cancel(item.id)
  }

  // limpia los estados terminales (done/error/canceled) — los activos se
  // quedan. No toca done/total: son la foto del LOTE, no de la lista.
  function clearFinished() {
    const keep: UploadItem[] = []
    for (const item of items.value) {
      if (item.status === 'queued' || item.status === 'uploading') {
        keep.push(item)
      } else {
        releaseObjectUrl(item)
      }
    }
    items.value = keep
  }

  // contadores derivados para el resumen ("3 subiendo · 12 en cola · …")
  const stats = computed(() => {
    const s = { queued: 0, uploading: 0, done: 0, error: 0, canceled: 0 }
    for (const item of items.value) s[item.status]++
    return s
  })

  // iOS suspende los XHR al pasar a background: los interrumpidos aparecen
  // como error (con retry visible) al rechazarse su promesa; al VOLVER a
  // foreground se re-bombea la cola para que lo que quedó en queued siga.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pump()
  })

  return {
    items,
    active,
    done,
    total,
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
