/**
 * File types in the reorganizer system
 */
export enum FileType {
  PHOTO = 'photo',
  VIDEO = 'video',
  UNKNOWN = 'unknown',
}

/**
 * Video orientation (for videos only)
 */
export enum Orientation {
  HORIZONTAL = 'horizontal',
  VERTICAL = 'vertical',
  NULL = '',
}

/**
 * Device type that captured the media
 */
export enum Device {
  PHONE = 'phone',
  DRONE = 'dron',
}

/**
 * Drone model
 */
export enum DroneModel {
  MINI3 = 'mini3',
}

/**
 * File information
 */
export interface File {
  name: string
  type: FileType
  orientation?: Orientation
  device?: Device
  extension: string
  previewUrl?: string
}

/**
 * Processing statistics during file organization
 */
export interface ProcessingStats {
  total: number
  processed: number
  pictures: number
  videos: number
  unknown: number
  errors: number
}

/**
 * Input folder statistics from /api/input/stats
 */
export interface InputStats {
  total: number
  pictures: number
  videos: number
  unknown: number
}

/**
 * Processing status
 */
export type ProcessingStatus = 'idle' | 'processing' | 'complete' | 'error'

/**
 * Full server-side state received on connect / sync
 */
export interface ServerState {
  status: ProcessingStatus
  stats: ProcessingStats
  logs: string[]
  errors: string[]
  output_path: string
}

/**
 * WebSocket JSON messages from server
 */
export type WebSocketMessage =
  | { type: 'state-sync'; data: ServerState }
  | { type: 'status'; data: ProcessingStatus }
  | { type: 'total'; data: number }
  | { type: 'processed'; data: { log: string; stats: ProcessingStats } }
  | { type: 'error'; data: string }
  | { type: 'log'; data: string }

/**
 * API response for input files listing
 */
export interface InputFilesResponse {
  files: string[]
}

/**
 * API response for output path suggestions
 */
export interface OutputSuggestionsResponse {
  suggestions: string[]
}

/**
 * Preview container position
 */
export interface Position {
  x: number
  y: number
}

/**
 * File preview state
 */
export interface PreviewState {
  currentFile: File | null
  position: Position
  isLoading: boolean
  error: string | null
}
