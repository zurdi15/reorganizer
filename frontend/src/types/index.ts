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
 * WebSocket message from server
 */
export type WebSocketMessage =
  | { type: 'total'; data: number }
  | { type: 'processed'; data: string }
  | { type: 'processed-pictures'; data: null }
  | { type: 'processed-videos'; data: null }
  | { type: 'error'; data: string }
  | { type: 'complete'; data: null }
  | { type: 'busy'; data: boolean }
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
