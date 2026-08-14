// Contrato de API del plan Reorganizer 2.0 (fuente de verdad: el plan y los
// schemas pydantic del backend). Solo tipos — cero runtime.

export type MediaKind = 'photo' | 'video' | 'unknown'
export type Orientation = 'horizontal' | 'vertical' | null
export type TransferMode = 'move' | 'copy'
export type DuplicateStrategy = 'rename' | 'skip' | 'overwrite'

// ---- Input ----

export interface InputFile {
  path: string
  name: string
  size_bytes: number
  // epoch en SEGUNDOS (float) tal cual lo serializa el backend — hay que
  // multiplicar por 1000 antes de construir un Date
  mtime: number
  // por extensión (barato); la clasificación real por contenido solo en planning
  kind: MediaKind
}

// página del listado del input (GET /input/files?limit=&offset=). El backend
// pagina: `total` es el recuento REAL del folder (miles de archivos posibles),
// independiente de cuántos se hayan traído en esta página. limit=0 → todos
// (curl/scripts); la UI siempre pide páginas acotadas.
export interface InputFilesPage {
  files: InputFile[]
  total: number
}

// contadores por kind (GET /input/summary)
export interface InputSummary {
  photo: number
  video: number
  unknown: number
  total: number
}

// sugerencias EXIF para el path builder (GET /input/dates). El backend
// serializa años y meses como STRINGS (los meses zero-padded, "08"): JSON no
// tiene claves numéricas y el backend mantiene el formato de carpeta.
export interface InputDates {
  years: string[]
  months_by_year: Record<string, string[]>
}

// probe on-demand de UN archivo (GET /input/probe?path=)
export interface InputProbe {
  media_type: MediaKind
  orientation: Orientation
  taken_at: string | null
  camera_make: string | null
  camera_model: string | null
  // regla que matchearía hoy con este archivo (null → fallback _unknown/).
  // El backend devuelve el objeto de la regla, no solo su id.
  matched_rule: { id: number; name: string; dest: string } | null
}

// ---- Uploads ----

export interface UploadResult {
  original_name: string
  stored_name: string
  size_bytes: number
  media_type: MediaKind
}

// ---- Output ----

// entrada del autocompletado del path builder (GET /output/dirs?path=):
// has_children permite pintar el afijo de "sigue habiendo árbol debajo"
export interface OutputDir {
  name: string
  has_children: boolean
}

// ---- Jobs ----

export type JobStatus =
  | 'planning'
  | 'planned'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'cancelled'
  | 'failed'
  | 'interrupted'
  | 'discarded'

export type JobItemStatus =
  | 'planned'
  | 'done'
  | 'skipped'
  | 'duplicate'
  | 'error'
  | 'cancelled'
  | 'missing'

export type ImmichStatus = 'ok' | 'failed' | 'skipped' | null

export interface JobCounters {
  done: number
  errors: number
  skipped: number
  total: number
}

export interface JobRead {
  id: number
  status: JobStatus
  dest_path: string
  transfer_mode: TransferMode
  duplicate_strategy: DuplicateStrategy
  // contadores denormalizados PLANOS, tal cual los serializa el JobRead
  // pydantic del backend (los `counters` anidados solo existen en el mensaje
  // WS item-done). `errors` es el CONTADOR; `error` es el slug del fallo
  // fatal del job (null si no lo hubo).
  total: number
  done: number
  errors: number
  skipped: number
  error: string | null
  immich_status: ImmichStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export interface JobItem {
  id: number
  job_id: number
  source_path: string
  size_bytes: number
  media_type: MediaKind | null
  orientation: Orientation
  taken_at: string | null
  camera_make: string | null
  camera_model: string | null
  // snapshot sin FK: la regla puede haberse borrado después
  matched_rule_id: number | null
  planned_dest: string | null
  final_dest: string | null
  status: JobItemStatus
  // slug de error i18n (errors.*), null si no falló
  error: string | null
  content_hash: string | null
  // colisión prevista (destino ya existe o dos items comparten planned_dest),
  // calculada por el backend SOLO mientras el job está `planned`
  collision: boolean | null
}

export interface JobCreate {
  dest_path: string
  // omitidos → el backend aplica los defaults guardados en settings y el
  // JobRead creado los devuelve resueltos (la UI muestra ese eco)
  transfer_mode?: TransferMode
  duplicate_strategy?: DuplicateStrategy
}

// ---- Rules ----

export interface Rule {
  id: number
  priority: number
  enabled: boolean
  // condiciones nullable AND-combinadas
  media_type: MediaKind | null
  orientation: Orientation
  filename_regex: string | null
  camera_make: string | null
  camera_model: string | null
  // placeholders: {orientation},{media_type},{make},{model},{yyyy},{mm}
  dest_template: string
}

// ---- Settings ----

export interface Settings {
  immich_enabled: boolean
  immich_url: string
  // enmascarada en lecturas
  immich_api_key: string
  immich_library_id: string
  default_duplicate_strategy: DuplicateStrategy
  default_transfer_mode: TransferMode
}

// ---- WebSocket (push-only; único mensaje entrante {"action":"sync"}) ----
// JSON puro, cero HTML — los nombres de archivo SIEMPRE se renderizan como
// nodos de texto (mata el XSS del Reorganizer viejo).

export interface WsStateSync {
  type: 'state-sync'
  data: { job: JobRead | null; events: WsMessage[] }
}

export interface WsJobStatus {
  type: 'job-status'
  data: { job_id: number; status: JobStatus }
}

export interface WsPlanProgress {
  type: 'plan-progress'
  data: { job_id: number; scanned: number; total: number }
}

export interface WsItemDone {
  type: 'item-done'
  data: {
    job_id: number
    item_id: number
    source_path: string
    media_type: MediaKind
    orientation: Orientation
    status: JobItemStatus
    dest: string | null
    error: string | null
    counters: JobCounters
  }
}

export interface WsJobError {
  type: 'job-error'
  data: { job_id: number; slug: string }
}

export interface WsImmich {
  type: 'immich'
  data: { job_id: number; status: Exclude<ImmichStatus, null> }
}

export interface WsInputChanged {
  type: 'input-changed'
  data: { counts: InputSummary }
}

export type WsMessage =
  | WsStateSync
  | WsJobStatus
  | WsPlanProgress
  | WsItemDone
  | WsJobError
  | WsImmich
  | WsInputChanged
