// Subida por TROZOS (chunks) sobre XMLHttpRequest — pensada para archivos de
// varios GB: un corte de red no tira toda la subida (se reanuda desde el
// último trozo confirmado) y los trozos pequeños esquivan límites de tamaño y
// timeouts del reverse proxy/ingress. Progreso real por bytes vía
// xhr.upload.onprogress acumulado sobre los trozos ya subidos.
//
// Flujo: POST /uploads/session (init) → PUT /uploads/session/{id} por trozo
// (header X-Chunk-Offset) → POST /uploads/session/{id}/complete. El estado
// (`received`) vive en el .part del servidor, así que GET /session/{id}
// reanuda tras un corte. El contrato de errores es el de client.ts (ApiError
// con slug i18n / OfflineError para fallos de red).
import { ApiError, OfflineError } from './client'
import type { UploadResult } from '@/types/api'

const BASE = '/api/v1'

// 8 MiB: suficientemente grande para saturar el enlace, suficientemente
// pequeño para reintentar barato y no chocar con límites del proxy
export const CHUNK_SIZE = 8 * 1024 * 1024
// reintentos por trozo ante fallo de red antes de rendir el item (que queda
// reintentar-able y reanudable)
const CHUNK_RETRIES = 4
const RETRY_BASE_MS = 500

// abort() dispara onabort, que rechaza con esta clase — el store la distingue
// de un error real (el item queda canceled, no error)
export class UploadAbortError extends Error {
  constructor() {
    super('aborted')
  }
}

// El servidor rechazó ABRIR la sesión porque ese nombre ya está en la bandeja
// y el ajuste de duplicados de subida es `skip` (409 file_exists). No es un
// fallo: el store marca el item como saltado y no se sube ni un byte.
export class UploadSkippedError extends Error {
  constructor() {
    super('skipped')
  }
}

// estado reanudable que el store guarda por item y vuelve a pasar en el retry:
// si ya hay uploadId, la subida CONTINÚA desde received en vez de reempezar
export interface ResumeState {
  uploadId?: string
  received?: number
}

export interface UploadHandle {
  promise: Promise<UploadResult[]>
  abort: () => void
}

interface ChunkErrorShape {
  status: number
  slug: string
  received?: number
}

class ChunkError extends Error {
  constructor(public info: ChunkErrorShape) {
    super(info.slug)
  }
}

// detail del backend: string ("file_too_large") o objeto ({slug, received}) en
// 409 (chunk_out_of_order / upload_incomplete)
function parseDetail(text: string): { slug: string; received?: number } {
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail
    if (typeof detail === 'string') return { slug: detail }
    if (detail && typeof detail === 'object') {
      const d = detail as { slug?: unknown; received?: unknown }
      if (typeof d.slug === 'string') {
        return { slug: d.slug, received: typeof d.received === 'number' ? d.received : undefined }
      }
    }
  } catch {
    // cuerpo no-JSON (HTML de un proxy, vacío) — sin pista aprovechable
  }
  return { slug: 'generic' }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// aborta una sesión en el servidor (libera su .part — importante con archivos
// de varios GB) al cancelar. Best-effort: un fallo aquí no importa (el arranque
// limpia los huérfanos igualmente).
export function deleteSession(uploadId: string): void {
  try {
    const xhr = new XMLHttpRequest()
    xhr.open('DELETE', `${BASE}/uploads/session/${uploadId}`)
    xhr.send()
  } catch {
    // ignora: la limpieza de arranque cubre los .part huérfanos
  }
}

export function uploadFile(
  file: File,
  opts: { onProgress?: (fraction: number) => void; resume?: ResumeState } = {},
): UploadHandle {
  const resume = opts.resume ?? {}
  let aborted = false
  let currentXhr: XMLHttpRequest | null = null

  // GET/POST sin progreso de subida (init de sesión y complete)
  function jsonRequest(
    method: 'GET' | 'POST',
    url: string,
    jsonBody?: object,
  ): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      currentXhr = xhr
      xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText })
      xhr.onerror = () => reject(new OfflineError())
      xhr.onabort = () => reject(new UploadAbortError())
      xhr.open(method, url)
      if (jsonBody !== undefined) {
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.send(JSON.stringify(jsonBody))
      } else {
        xhr.send()
      }
    })
  }

  // abre la sesión (o la reanuda si ya hay uploadId) y devuelve `received`
  async function initSession(): Promise<number> {
    if (resume.uploadId) {
      const r = await jsonRequest('GET', `${BASE}/uploads/session/${resume.uploadId}`)
      if (r.status >= 200 && r.status < 300) {
        resume.received = (JSON.parse(r.text) as { received: number }).received
        return resume.received
      }
      if (r.status !== 404) throw new ApiError(r.status, parseDetail(r.text).slug)
      resume.uploadId = undefined // 404: sesión caducada → se abre otra
    }
    const r = await jsonRequest('POST', `${BASE}/uploads/session`, {
      filename: file.name,
      total_size: file.size,
    })
    if (r.status < 200 || r.status >= 300) {
      const info = parseDetail(r.text)
      // el archivo ya está en la bandeja y el ajuste es `skip`: se corta AQUÍ,
      // antes de mandar ningún trozo (el sentido de la opción con varios GB)
      if (r.status === 409 && info.slug === 'file_exists') throw new UploadSkippedError()
      throw new ApiError(r.status, info.slug)
    }
    const session = JSON.parse(r.text) as { upload_id: string; received: number }
    resume.uploadId = session.upload_id
    resume.received = session.received
    return session.received
  }

  // PUT de UN trozo (con header X-Chunk-Offset) y reintentos de red; devuelve
  // el nuevo `received`. Lanza ChunkError en 4xx/5xx (con `received` en 409).
  async function putChunk(offset: number): Promise<number> {
    const blob = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size))
    for (let attempt = 0; ; attempt++) {
      if (aborted) throw new UploadAbortError()
      try {
        return await new Promise<number>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          currentXhr = xhr
          xhr.upload.onprogress = (e: ProgressEvent) => {
            if (e.lengthComputable) {
              opts.onProgress?.(Math.min(1, (offset + e.loaded) / (file.size || 1)))
            }
          }
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve((JSON.parse(xhr.responseText) as { received: number }).received)
            } else {
              const info = parseDetail(xhr.responseText)
              reject(new ChunkError({ status: xhr.status, slug: info.slug, received: info.received }))
            }
          }
          xhr.onerror = () => reject(new OfflineError())
          xhr.onabort = () => reject(new UploadAbortError())
          xhr.open('PUT', `${BASE}/uploads/session/${resume.uploadId}`)
          xhr.setRequestHeader('X-Chunk-Offset', String(offset))
          xhr.send(blob)
        })
      } catch (err) {
        if (err instanceof UploadAbortError || err instanceof ChunkError) throw err
        // fallo de red transitorio: backoff y reintento del mismo offset
        if (err instanceof OfflineError && attempt < CHUNK_RETRIES) {
          await sleep(RETRY_BASE_MS * 2 ** attempt)
          continue
        }
        throw err
      }
    }
  }

  async function run(): Promise<UploadResult[]> {
    let received = await initSession()
    while (received < file.size) {
      if (aborted) throw new UploadAbortError()
      const offset = received
      try {
        received = await putChunk(offset)
      } catch (err) {
        if (err instanceof ChunkError) {
          if (err.info.slug === 'chunk_out_of_order' && typeof err.info.received === 'number') {
            received = err.info.received // resincroniza y sigue
            continue
          }
          if (err.info.status === 404) {
            resume.uploadId = undefined // sesión perdida → reabrir
            received = await initSession()
            continue
          }
          throw new ApiError(err.info.status, err.info.slug)
        }
        throw err
      }
      resume.received = received
    }
    const r = await jsonRequest('POST', `${BASE}/uploads/session/${resume.uploadId}/complete`)
    if (r.status >= 200 && r.status < 300) {
      opts.onProgress?.(1)
      return [JSON.parse(r.text) as UploadResult]
    }
    const info = parseDetail(r.text)
    if (info.slug === 'upload_incomplete' && typeof info.received === 'number') {
      resume.received = info.received // carrera rara: aún faltan bytes → reciclar
      return run()
    }
    throw new ApiError(r.status, info.slug)
  }

  return {
    promise: run(),
    abort: () => {
      aborted = true
      currentXhr?.abort()
    },
  }
}
