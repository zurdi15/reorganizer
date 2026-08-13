// Endpoints tipados de jobs: lecturas del historial (fase 10) + ciclo de
// vida crear/execute/cancel (fase 12, consumidos por stores/organize.ts).
import { api } from './client'
import type { JobCreate, JobItem, JobItemStatus, JobRead } from '@/types/api'

export function fetchJobs(): Promise<JobRead[]> {
  return api<JobRead[]>('/jobs')
}

export function fetchJob(id: number): Promise<JobRead> {
  return api<JobRead>(`/jobs/${id}`)
}

// paginado en el backend: limit/offset opcionales (los defaults del server
// bastan para la vista de historial inicial); status filtra en el server
export function fetchJobItems(
  id: number,
  params: { limit?: number; offset?: number; status?: JobItemStatus } = {},
): Promise<JobItem[]> {
  const query = new URLSearchParams()
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))
  if (params.status !== undefined) query.set('status', params.status)
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  return api<JobItem[]>(`/jobs/${id}/items${suffix}`)
}

// ---- ciclo de vida ----

// crea el job en `planning` y arranca el dry-run asíncrono. transfer_mode /
// duplicate_strategy omitidos → defaults de settings aplicados en el server
// (JSON.stringify descarta claves undefined, así que basta con no ponerlas).
// Errores esperables: 409 job_already_active · 400 invalid_path ·
// 422 invalid_transfer_mode / invalid_duplicate_strategy.
export function createJob(payload: JobCreate): Promise<JobRead> {
  return api<JobRead>('/jobs', { method: 'POST', body: payload })
}

// solo válido desde `planned` (409 job_not_planned en el resto)
export function executeJob(id: number): Promise<JobRead> {
  return api<JobRead>(`/jobs/${id}/execute`, { method: 'POST' })
}

// cancelación cooperativa: válida en planning|running (409 job_not_cancellable);
// el 202 devuelve el job aún vivo — el job-status `cancelled` llegará por WS
export function cancelJob(id: number): Promise<JobRead> {
  return api<JobRead>(`/jobs/${id}/cancel`, { method: 'POST' })
}
