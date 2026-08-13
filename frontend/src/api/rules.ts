// Endpoints tipados del dominio rules (fase 13). Funciones finas sobre
// api(); el estado (lista + optimismo del reorder) vive en stores/settings.ts.
import { api } from './client'
import type { MediaKind, Orientation, Rule } from '@/types/api'

// El Rule de types/api.ts se escribió antes de la migración 0002 y se quedó
// sin `name` (ni timestamps), que SÍ viajan en el RuleRead real del backend.
// Corrección local (extend, no redefinición divergente) — ver informe.
export interface RuleRead extends Rule {
  name: string | null
  created_at: string
  updated_at: string
}

// una regla nunca enruta 'unknown' (esos archivos van al fallback _unknown/)
export type RuleMediaType = Exclude<MediaKind, 'unknown'>

// Payload de POST (crear) y PATCH (parcial). En PATCH, un null EXPLÍCITO en
// un campo-condición BORRA la condición; en los no anulables
// (enabled/dest_template) el backend ignora null. Campo ausente = sin tocar.
export interface RuleSavePayload {
  name?: string | null
  enabled?: boolean
  media_type?: RuleMediaType | null
  orientation?: Orientation
  filename_regex?: string | null
  camera_make?: string | null
  camera_model?: string | null
  dest_template?: string
  priority?: number
}

export interface RuleTestRequest {
  filename: string
  media_type: MediaKind
  orientation?: Exclude<Orientation, null>
  camera_make?: string
  camera_model?: string
  // permite probar plantillas con {yyyy}/{mm} sin un archivo real
  taken_at?: string
}

export interface RuleTestResult {
  // todo null = ninguna regla matcheó (el planner usaría _unknown/)
  matched_rule_id: number | null
  matched_rule_name: string | null
  dest: string | null
}

export function fetchRules(): Promise<RuleRead[]> {
  return api<RuleRead[]>('/rules')
}

export function createRule(payload: RuleSavePayload): Promise<RuleRead> {
  return api<RuleRead>('/rules', { method: 'POST', body: payload })
}

export function patchRule(id: number, payload: RuleSavePayload): Promise<RuleRead> {
  return api<RuleRead>(`/rules/${id}`, { method: 'PATCH', body: payload })
}

export function deleteRule(id: number): Promise<void> {
  return api<void>(`/rules/${id}`, { method: 'DELETE' })
}

// permutación exacta de TODOS los ids en el nuevo orden; el server reescribe
// priorities 10,20,30… y devuelve la lista canónica ya ordenada
export function reorderRules(ids: number[]): Promise<RuleRead[]> {
  return api<RuleRead[]>('/rules/reorder', { method: 'POST', body: { ids } })
}

export function testRules(payload: RuleTestRequest): Promise<RuleTestResult> {
  return api<RuleTestResult>('/rules/test', { method: 'POST', body: payload })
}
