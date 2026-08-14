import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, OfflineError } from '@/api/client'
import { UploadAbortError, uploadFile, UploadSkippedError } from '@/api/uploads'

// XHR de mentira controlable desde el test: la subida por trozos encadena
// varias requests (POST /session → PUT chunk → POST complete), así que el test
// responde a cada instancia según va apareciendo.
class MockXHR {
  static instances: MockXHR[] = []

  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  status = 0
  responseText = ''
  method = ''
  url = ''
  headers: Record<string, string> = {}
  sent: unknown = null
  aborted = false

  constructor() {
    MockXHR.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body?: unknown) {
    this.sent = body ?? null
  }

  abort() {
    this.aborted = true
    this.onabort?.()
  }

  respond(status: number, body: string) {
    this.status = status
    this.responseText = body
    this.onload?.()
  }
}

function lastXhr(): MockXHR {
  return MockXHR.instances.at(-1)!
}

// deja correr los await encadenados del api hasta que aparece la siguiente XHR
const flush = () => new Promise((r) => setTimeout(r, 0))

// 3 bytes → un solo trozo: POST session → PUT (offset 0) → POST complete
const file = new File(['abc'], 'foto.jpg', { type: 'image/jpeg' })
const RESULT = {
  original_name: 'foto.jpg',
  stored_name: 'foto.jpg',
  size_bytes: 3,
  media_type: 'photo',
  status: 'stored',
}

describe('api/uploads (chunked)', () => {
  beforeEach(() => {
    MockXHR.instances = []
    vi.stubGlobal('XMLHttpRequest', MockXHR)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a session, PUTs the chunk with X-Chunk-Offset and completes', async () => {
    const onProgress = vi.fn()
    const { promise } = uploadFile(file, { onProgress })

    await flush()
    let xhr = lastXhr()
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/v1/uploads/session')
    expect(JSON.parse(xhr.sent as string)).toEqual({ filename: 'foto.jpg', total_size: 3 })
    xhr.respond(201, JSON.stringify({ upload_id: 'U1', received: 0, total_size: 3 }))

    await flush()
    xhr = lastXhr()
    expect(xhr.method).toBe('PUT')
    expect(xhr.url).toBe('/api/v1/uploads/session/U1')
    expect(xhr.headers['X-Chunk-Offset']).toBe('0')
    expect(xhr.sent).toBeInstanceOf(Blob)
    // progreso acumulado: (offset 0 + loaded)/size
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 3, total: 3 } as ProgressEvent)
    expect(onProgress).toHaveBeenLastCalledWith(1)
    xhr.respond(200, JSON.stringify({ received: 3 }))

    await flush()
    xhr = lastXhr()
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/v1/uploads/session/U1/complete')
    xhr.respond(201, JSON.stringify(RESULT))

    await expect(promise).resolves.toEqual([RESULT])
  })

  it('resyncs the offset when a chunk returns 409 chunk_out_of_order', async () => {
    const { promise } = uploadFile(file)
    await flush()
    lastXhr().respond(201, JSON.stringify({ upload_id: 'U1', received: 0, total_size: 3 }))

    await flush()
    // el server dice que ya tiene 2 bytes → el cliente reanuda desde offset 2
    lastXhr().respond(
      409,
      JSON.stringify({ detail: { slug: 'chunk_out_of_order', received: 2 } }),
    )

    await flush()
    const retryXhr = lastXhr()
    expect(retryXhr.method).toBe('PUT')
    expect(retryXhr.headers['X-Chunk-Offset']).toBe('2')
    retryXhr.respond(200, JSON.stringify({ received: 3 }))

    await flush()
    lastXhr().respond(201, JSON.stringify(RESULT))
    await expect(promise).resolves.toEqual([RESULT])
  })

  it('resumes an existing session via GET instead of re-opening', async () => {
    const { promise } = uploadFile(file, { resume: { uploadId: 'OLD' } })
    await flush()
    const getXhr = lastXhr()
    expect(getXhr.method).toBe('GET')
    expect(getXhr.url).toBe('/api/v1/uploads/session/OLD')
    getXhr.respond(200, JSON.stringify({ upload_id: 'OLD', received: 3, total_size: 3 }))
    // received == size ⇒ salta directo a complete, sin más PUT
    await flush()
    const completeXhr = lastXhr()
    expect(completeXhr.url).toBe('/api/v1/uploads/session/OLD/complete')
    completeXhr.respond(201, JSON.stringify(RESULT))
    await expect(promise).resolves.toEqual([RESULT])
  })

  it('rejects with ApiError carrying the backend slug (413 on session open)', async () => {
    const { promise } = uploadFile(file)
    await flush()
    lastXhr().respond(413, JSON.stringify({ detail: 'file_too_large' }))
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(413)
    expect((error as ApiError).slug).toBe('file_too_large')
  })

  it('rejects with UploadSkippedError when the session open returns 409 file_exists', async () => {
    const { promise } = uploadFile(file)
    await flush()
    lastXhr().respond(409, JSON.stringify({ detail: 'file_exists' }))
    await expect(promise).rejects.toBeInstanceOf(UploadSkippedError)
    // ni un solo trozo viaja: solo se hizo el POST de apertura
    expect(MockXHR.instances).toHaveLength(1)
  })

  it('resolves with a skipped result when complete reports the file already existed', async () => {
    const { promise } = uploadFile(file)
    await flush()
    lastXhr().respond(201, JSON.stringify({ upload_id: 'U1', received: 0, total_size: 3 }))
    await flush()
    lastXhr().respond(200, JSON.stringify({ received: 3 }))
    await flush()
    // carrera: el nombre apareció mientras subían los trozos
    lastXhr().respond(201, JSON.stringify({ ...RESULT, status: 'skipped' }))
    await expect(promise).resolves.toEqual([{ ...RESULT, status: 'skipped' }])
  })

  it('falls back to the generic slug on an unparseable error body', async () => {
    const { promise } = uploadFile(file)
    await flush()
    lastXhr().respond(502, '<html>Bad Gateway</html>')
    const error = await promise.catch((e: unknown) => e)
    expect((error as ApiError).slug).toBe('generic')
  })

  it('rejects with OfflineError on a network failure opening the session', async () => {
    const { promise } = uploadFile(file)
    await flush()
    lastXhr().onerror!()
    await expect(promise).rejects.toBeInstanceOf(OfflineError)
  })

  it('abort() aborts the in-flight XHR and rejects with UploadAbortError', async () => {
    const { promise, abort } = uploadFile(file)
    await flush()
    abort()
    expect(lastXhr().aborted).toBe(true)
    await expect(promise).rejects.toBeInstanceOf(UploadAbortError)
  })
})
