// Subida de UN archivo por request sobre XMLHttpRequest — fetch sigue sin
// exponer progreso de SUBIDA (solo de descarga), y el progreso por archivo
// es el corazón de la feature estrella: xhr.upload.onprogress da bytes
// reales en vuelo. El contrato de errores es el mismo de client.ts
// (ApiError con slug i18n / OfflineError para fallos de red).
import { ApiError, OfflineError } from './client'
import type { UploadResult } from '@/types/api'

const BASE = '/api/v1'

// abort() dispara onabort, que rechaza con esta clase — el store la
// distingue de un error real (el item queda canceled, no error)
export class UploadAbortError extends Error {
  constructor() {
    super('aborted')
  }
}

export interface UploadHandle {
  promise: Promise<UploadResult[]>
  abort: () => void
}

// el backend de uploads responde detail como slug string (413
// file_too_large, 422 too_many_files/no_files); cualquier otra forma
// (HTML de un proxy, cuerpo vacío) cae al slug generic
function slugFromBody(text: string): string {
  try {
    const detail = (JSON.parse(text) as { detail?: unknown }).detail
    if (typeof detail === 'string') return detail
  } catch {
    // cuerpo no-JSON — sin pista aprovechable
  }
  return 'generic'
}

export function uploadFile(
  file: File,
  opts: { onProgress?: (fraction: number) => void } = {},
): UploadHandle {
  const xhr = new XMLHttpRequest()

  const promise = new Promise<UploadResult[]>((resolve, reject) => {
    // progreso basado en BYTES (no en etapas): fracción 0..1 estricta
    xhr.upload.onprogress = (event: ProgressEvent) => {
      if (event.lengthComputable && event.total > 0) {
        opts.onProgress?.(Math.min(1, event.loaded / event.total))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadResult[])
        } catch {
          // 2xx con cuerpo ilegible: no debería pasar, pero jamás colgarse
          reject(new ApiError(xhr.status, 'generic'))
        }
        return
      }
      reject(new ApiError(xhr.status, slugFromBody(xhr.responseText)))
    }

    // fallo de RED (DNS, conexión cortada, iOS matando el socket al pasar a
    // background) — misma categoría OfflineError que client.ts: la vista lo
    // muestra como errors.offline, con reintento implícito
    xhr.onerror = () => reject(new OfflineError())
    xhr.onabort = () => reject(new UploadAbortError())

    // FormData con el campo `files` del contrato; el navegador pone el
    // boundary del multipart (nada de Content-Type manual)
    const form = new FormData()
    form.append('files', file)
    xhr.open('POST', `${BASE}/uploads`)
    xhr.send(form)
  })

  return { promise, abort: () => xhr.abort() }
}
