import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, OfflineError } from '@/api/client'
import { UploadAbortError, uploadFile } from '@/api/uploads'

// XHR de mentira controlable desde el test: registra cada instancia para
// inspeccionar método/URL/cuerpo y disparar sus callbacks a mano
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
  sent: unknown = null
  aborted = false

  constructor() {
    MockXHR.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  send(body: unknown) {
    this.sent = body
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

const file = new File(['abc'], 'foto.jpg', { type: 'image/jpeg' })

describe('api/uploads (XHR)', () => {
  beforeEach(() => {
    MockXHR.instances = []
    vi.stubGlobal('XMLHttpRequest', MockXHR)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs multipart to /api/v1/uploads with the file under the `files` field', () => {
    uploadFile(file)
    const xhr = lastXhr()
    expect(xhr.method).toBe('POST')
    expect(xhr.url).toBe('/api/v1/uploads')
    expect(xhr.sent).toBeInstanceOf(FormData)
    expect((xhr.sent as FormData).get('files')).toBe(file)
  })

  it('reports byte-based upload progress as a 0..1 fraction', () => {
    const onProgress = vi.fn()
    uploadFile(file, { onProgress })
    const xhr = lastXhr()

    xhr.upload.onprogress!({ lengthComputable: true, loaded: 512, total: 1024 } as ProgressEvent)
    expect(onProgress).toHaveBeenLastCalledWith(0.5)

    // sin longitud computable no hay fracción que inventar
    xhr.upload.onprogress!({ lengthComputable: false, loaded: 9, total: 0 } as ProgressEvent)
    expect(onProgress).toHaveBeenCalledTimes(1)
  })

  it('resolves the parsed UploadResult[] on 201', async () => {
    const { promise } = uploadFile(file)
    const body = [
      { original_name: 'foto.jpg', stored_name: 'foto.jpg', size_bytes: 3, media_type: 'photo' },
    ]
    lastXhr().respond(201, JSON.stringify(body))
    await expect(promise).resolves.toEqual(body)
  })

  it('rejects with ApiError carrying the backend slug (413 file_too_large)', async () => {
    const { promise } = uploadFile(file)
    lastXhr().respond(413, JSON.stringify({ detail: 'file_too_large' }))
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(413)
    expect((error as ApiError).slug).toBe('file_too_large')
  })

  it('falls back to the generic slug on an unparseable error body', async () => {
    const { promise } = uploadFile(file)
    lastXhr().respond(502, '<html>Bad Gateway</html>')
    const error = await promise.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).slug).toBe('generic')
  })

  it('rejects with OfflineError on a network failure', async () => {
    const { promise } = uploadFile(file)
    lastXhr().onerror!()
    await expect(promise).rejects.toBeInstanceOf(OfflineError)
  })

  it('abort() aborts the underlying XHR and rejects with UploadAbortError', async () => {
    const { promise, abort } = uploadFile(file)
    abort()
    expect(lastXhr().aborted).toBe(true)
    await expect(promise).rejects.toBeInstanceOf(UploadAbortError)
  })
})
