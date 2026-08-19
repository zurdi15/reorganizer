import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { ApiError, OfflineError } from '@/api/client'
import { UploadSkippedError } from '@/api/uploads'
import { drainHooks, useUploadsStore, UPLOAD_CONCURRENCY } from '@/stores/uploads'
import { useToastStore } from '@/stores/toast'

// mock de api/uploads: cada llamada deja un "deferred" controlable desde el
// test (resolver/rechazar/abortar a mano) — así se ejercita concurrencia,
// progreso y cancelación sin XHR real. Se conserva UploadAbortError real
// (el store hace instanceof sobre ella).
const mocked = vi.hoisted(() => ({
  calls: [] as Array<{
    file: File
    onProgress?: (fraction: number) => void
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
    abort: () => void
    abortCalled: boolean
  }>,
}))

vi.mock('@/api/uploads', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/uploads')>()
  return {
    ...actual,
    uploadFile: vi.fn((file: File, opts: { onProgress?: (fraction: number) => void } = {}) => {
      let resolveFn!: (value: unknown) => void
      let rejectFn!: (error: unknown) => void
      const promise = new Promise((res, rej) => {
        resolveFn = res
        rejectFn = rej
      })
      const call: (typeof mocked.calls)[number] = {
        file,
        onProgress: opts.onProgress,
        resolve: resolveFn,
        reject: rejectFn,
        abortCalled: false,
        abort: () => {
          call.abortCalled = true
          rejectFn(new actual.UploadAbortError())
        },
      }
      mocked.calls.push(call)
      return { promise, abort: call.abort }
    }),
  }
})

// microtareas + timers 0: deja que los .then/.finally del store corran
function flush() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

function makeFile(name = 'foto.jpg', type = 'image/jpeg') {
  return new File(['x'], name, { type })
}

// llamadas del mock para UN archivo concreto — por NOMBRE, no identidad:
// el File que llega al mock es el proxy reactivo del item, no el original.
// (Y los listeners de visibilitychange de stores de tests anteriores
// comparten document: contar llamadas en global descuadraría.)
function callsFor(file: File) {
  return mocked.calls.filter((c) => c.file.name === file.name)
}

let blobSeq = 0
let refreshSpy: MockInstance

describe('stores/uploads', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mocked.calls.length = 0
    blobSeq = 0
    URL.createObjectURL = vi.fn(() => `blob:mock-${++blobSeq}`)
    URL.revokeObjectURL = vi.fn()
    refreshSpy = vi.spyOn(drainHooks, 'refreshInput').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enqueue maps kind from the MIME type and creates objectURLs only for images', () => {
    const store = useUploadsStore()
    store.enqueue([
      makeFile('a.jpg', 'image/jpeg'),
      makeFile('b.mp4', 'video/mp4'),
      makeFile('c.txt', 'text/plain'),
    ])
    expect(store.items.map((i) => i.kind)).toEqual(['image', 'video', 'other'])
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(store.items[0].objectUrl).toBe('blob:mock-1')
    expect(store.items[1].objectUrl).toBeUndefined()
  })

  it('honors UPLOAD_CONCURRENCY=2 and pumps the next queued file on each settle', async () => {
    const store = useUploadsStore()
    const files = [1, 2, 3, 4, 5].map((n) => makeFile(`f${n}.jpg`))
    store.enqueue(files)

    expect(mocked.calls).toHaveLength(UPLOAD_CONCURRENCY)
    expect(store.items.map((i) => i.status)).toEqual([
      'uploading',
      'uploading',
      'queued',
      'queued',
      'queued',
    ])
    expect(store.active).toBe(true)
    expect(store.total).toBe(5)
    expect(store.done).toBe(0)

    mocked.calls[0].resolve([])
    await flush()
    expect(store.done).toBe(1)
    expect(store.items[0].status).toBe('done')
    // el hueco libre se rellena con el siguiente de la cola
    expect(mocked.calls).toHaveLength(3)
    expect(store.items[2].status).toBe('uploading')
  })

  it('wires byte-based progress into the item', () => {
    const store = useUploadsStore()
    store.enqueue([makeFile()])
    mocked.calls[0].onProgress!(0.4)
    expect(store.items[0].progress).toBe(0.4)
  })

  it('on drain: active goes false, the input refresh hook fires and a success toast shows', async () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg'), makeFile('b.jpg')])
    mocked.calls[0].resolve([])
    mocked.calls[1].resolve([])
    await flush()

    expect(store.active).toBe(false)
    expect(store.done).toBe(2)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
    const toasts = useToastStore().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0].kind).toBe('ok')
  })

  it('resets batch counters when a new batch starts after a drain', async () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg')])
    mocked.calls[0].resolve([])
    await flush()
    expect(store.done).toBe(1)
    expect(store.total).toBe(1)

    store.enqueue([makeFile('b.jpg')])
    expect(store.done).toBe(0)
    expect(store.total).toBe(1)
    expect(store.active).toBe(true)
  })

  it('maps API/network failures to error slugs and retry() resets the item and re-uploads', async () => {
    const store = useUploadsStore()
    const file = makeFile('a.jpg')
    store.enqueue([file])
    mocked.calls[0].reject(new ApiError(413, 'file_too_large'))
    await flush()

    const item = store.items[0]
    expect(item.status).toBe('error')
    expect(item.errorSlug).toBe('file_too_large')
    expect(store.active).toBe(false)
    // nada subió: ni refresh ni toast
    expect(refreshSpy).not.toHaveBeenCalled()
    expect(useToastStore().toasts).toHaveLength(0)

    store.retry(item.id)
    expect(item.status).toBe('uploading')
    expect(item.errorSlug).toBeUndefined()
    expect(item.progress).toBe(0)
    expect(callsFor(file)).toHaveLength(2)
    expect(store.active).toBe(true)
    expect(store.total).toBe(1)
    expect(store.done).toBe(0)

    mocked.calls.at(-1)!.resolve([])
    await flush()
    expect(store.done).toBe(1)
    expect(refreshSpy).toHaveBeenCalledTimes(1)
  })

  it('retryFailed() requeues every errored item', async () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg'), makeFile('b.jpg')])
    mocked.calls[0].reject(new OfflineError())
    mocked.calls[1].reject(new OfflineError())
    await flush()
    expect(store.items.map((i) => i.errorSlug)).toEqual(['offline', 'offline'])

    store.retryFailed()
    expect(store.items.map((i) => i.status)).toEqual(['uploading', 'uploading'])
    expect(store.items.map((i) => i.errorSlug)).toEqual([undefined, undefined])
  })

  it('cancel() on a queued item drops it, revokes its objectURL and returns its batch slot', () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg')])
    const queued = store.items[2]
    expect(queued.status).toBe('queued')

    store.cancel(queued.id)
    expect(store.items).toHaveLength(2)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-3')
    expect(store.total).toBe(2)
  })

  it('cancel() on an uploading item aborts the in-flight XHR and keeps it as canceled', async () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg')])
    const item = store.items[0]

    store.cancel(item.id)
    expect(mocked.calls[0].abortCalled).toBe(true)
    await flush()
    expect(item.status).toBe('canceled')
    expect(store.items).toHaveLength(1)
    expect(store.active).toBe(false)
    // un lote 100% cancelado no celebra nada ni refresca el input
    expect(refreshSpy).not.toHaveBeenCalled()
    expect(useToastStore().toasts).toHaveLength(0)
  })

  it('cancelPending() drops every queued item but leaves in-flight uploads alone', () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg'), makeFile('b.jpg'), makeFile('c.jpg'), makeFile('d.jpg')])
    store.cancelPending()

    expect(store.items).toHaveLength(2)
    expect(store.items.every((i) => i.status === 'uploading')).toBe(true)
    expect(store.total).toBe(2)
    expect(mocked.calls.every((c) => !c.abortCalled)).toBe(true)
  })

  it('clearFinished() removes terminal items and revokes their objectURLs, keeping active ones', async () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg'), makeFile('b.jpg')])
    mocked.calls[0].resolve([])
    await flush()
    expect(store.items[0].status).toBe('done')

    store.clearFinished()
    expect(store.items).toHaveLength(1)
    expect(store.items[0].status).toBe('uploading')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:mock-2')
  })

  it('clearFinished() KEEPS failed items so they can still be retried', async () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('ok.jpg'), makeFile('boom.jpg')])
    // ok.jpg termina; boom.jpg falla (no cancelado)
    callsFor(store.items[0].file)[0].resolve([])
    callsFor(store.items[1].file)[0].reject(new ApiError(500, 'transfer_failed'))
    await flush()
    expect(store.items[0].status).toBe('done')
    expect(store.items[1].status).toBe('error')

    store.clearFinished()
    // el done se barre; el error SE QUEDA (es lo que se quiere reintentar)
    expect(store.items.map((i) => i.status)).toEqual(['error'])
    expect(store.items[0].name).toBe('boom.jpg')
  })

  it('marks the item as skipped (not error) when the server refuses to open the session', async () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg'), makeFile('b.jpg')])
    // a.jpg ya estaba en la bandeja; b.jpg sube de verdad
    mocked.calls[0].reject(new UploadSkippedError())
    mocked.calls[1].resolve([])
    await flush()

    expect(store.items.map((i) => i.status)).toEqual(['skipped', 'done'])
    expect(store.items[0].errorSlug).toBeUndefined()
    // fuera de `done` (nada se subió) pero contado como resuelto para el badge
    expect(store.done).toBe(1)
    expect(store.skipped).toBe(1)
    expect(store.processed).toBe(2)
    expect(store.stats.skipped).toBe(1)
    // el saltado no se puede reintentar: volvería a saltarse
    store.retry(store.items[0].id)
    expect(callsFor(store.items[0].file)).toHaveLength(1)

    // un toast por cada cosa: el éxito y el aviso de los ya presentes
    const toasts = useToastStore().toasts
    expect(toasts.map((t) => t.kind)).toEqual(['ok', 'info'])
    expect(toasts[1].message).toContain('ya estaba en la bandeja')
  })

  it('marks the item as skipped when complete reports the file already existed', async () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg')])
    // carrera resuelta en el server: la subida acabó pero no se guardó nada
    mocked.calls[0].resolve([{ stored_name: 'a.jpg', status: 'skipped' }])
    await flush()

    expect(store.items[0].status).toBe('skipped')
    expect(store.done).toBe(0)
    expect(store.skipped).toBe(1)
    // nada aterrizó en el input: ni refresh ni toast de éxito
    expect(refreshSpy).not.toHaveBeenCalled()
    expect(useToastStore().toasts.map((t) => t.kind)).toEqual(['info'])
  })

  it('clearFinished() also sweeps skipped items', async () => {
    const store = useUploadsStore()
    store.enqueue([makeFile('a.jpg'), makeFile('b.jpg')])
    mocked.calls[0].reject(new UploadSkippedError())
    mocked.calls[1].reject(new ApiError(500, 'transfer_failed'))
    await flush()

    store.clearFinished()
    expect(store.items.map((i) => i.status)).toEqual(['error'])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1')
  })

  // Los contadores del resumen se MANTIENEN en cada transición (antes se
  // derivaban recorriendo la lista entera en cada archivo terminado, que era
  // el coste cuadrático del lote). Este test es el que garantiza que ninguna
  // transición se salte la contabilidad.
  it('keeps the status counters exact across a whole batch', async () => {
    const store = useUploadsStore()
    store.enqueue(Array.from({ length: 12 }, (_, i) => makeFile(`f${i}.jpg`)))
    expect(store.stats.queued).toBe(12 - UPLOAD_CONCURRENCY)
    expect(store.stats.uploading).toBe(UPLOAD_CONCURRENCY)

    // se van resolviendo/fallando por tandas: el pump rellena huecos solo
    for (let settled = 0; settled < 12; settled++) {
      const call = mocked.calls[settled]
      if (settled % 4 === 3) call.reject(new ApiError(500, 'transfer_failed'))
      else call.resolve([])
      await flush()
    }

    expect(store.stats).toMatchObject({ queued: 0, uploading: 0, done: 9, error: 3 })
    expect(store.items.every((i) => i.status !== 'queued')).toBe(true)
    expect(store.active).toBe(false)
    expect(store.done).toBe(9)
  })

  it('keeps the counters exact through cancelPending() and clearFinished()', async () => {
    const store = useUploadsStore()
    store.enqueue(Array.from({ length: 6 }, (_, i) => makeFile(`f${i}.jpg`)))
    mocked.calls[0].resolve([])
    await flush()

    // 1 done, 2 uploading (el pump rellenó), 3 en cola
    expect(store.stats).toMatchObject({ done: 1, uploading: 2, queued: 3 })
    store.cancelPending()
    expect(store.stats.queued).toBe(0)
    expect(store.items).toHaveLength(3)
    expect(store.total).toBe(3)

    store.clearFinished()
    expect(store.stats).toMatchObject({ done: 0, uploading: 2, queued: 0 })
    expect(store.items).toHaveLength(2)

    // y la cola sigue viva: al terminar lo que quedaba en vuelo, drena
    mocked.calls.at(-1)!.resolve([])
    mocked.calls.at(-2)!.resolve([])
    await flush()
    expect(store.active).toBe(false)
    expect(store.stats.uploading).toBe(0)
  })

  it('revives offline-failed items and re-pumps when the page returns to foreground', async () => {
    const store = useUploadsStore()
    const file = makeFile('a.jpg')
    store.enqueue([file])
    // iOS suspende el XHR en background: la promesa se rechaza como red caída
    mocked.calls.at(-1)!.reject(new OfflineError())
    await flush()
    expect(store.items[0].status).toBe('error')
    expect(store.stats.error).toBe(1)

    document.dispatchEvent(new Event('visibilitychange'))
    expect(callsFor(file)).toHaveLength(2)
    expect(store.items[0].status).toBe('uploading')
    // los contadores acompañan la resurrección (el resumen no miente)
    expect(store.stats.error).toBe(0)
    expect(store.stats.uploading).toBe(1)
  })
})
