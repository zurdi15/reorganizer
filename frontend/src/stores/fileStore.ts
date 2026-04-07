import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { File, FileType, InputStats } from '../types/index'

export const useFileStore = defineStore('file', () => {
  const files = ref<File[]>([])
  const selectedFile = ref<File | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const inputStats = ref<InputStats>({ total: 0, pictures: 0, videos: 0, unknown: 0 })

  const baseUrl = import.meta.env.DEV ? 'http://localhost:3334' : ''

  /**
   * Fetch input files from the server
   */
  const fetchInputFiles = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const response = await fetch(`${baseUrl}/api/input`, {
        headers: { 'Accept': 'application/json' }
      })
      const data: string[] = await response.json()

      files.value = data.map(fileName => {
        const extension = fileName.split('.').pop()?.toLowerCase() || ''
        const pictureExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff', 'heic', 'heif', 'webp']
        const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv', 'm4v', '3gp', 'webm', 'mts']

        let type: FileType = 'unknown' as FileType
        if (pictureExtensions.includes(extension)) {
          type = 'photo' as FileType
        } else if (videoExtensions.includes(extension)) {
          type = 'video' as FileType
        }

        return {
          name: fileName,
          type,
          extension,
          previewUrl: `${baseUrl}/media/${fileName}`,
        } as File
      })
    } catch (err) {
      error.value = `Failed to fetch input files: ${err}`
      files.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * Fetch input file stats from the server
   */
  const fetchInputStats = async (): Promise<void> => {
    try {
      const response = await fetch(`${baseUrl}/api/input/stats`, {
        headers: { 'Accept': 'application/json' }
      })
      inputStats.value = await response.json()
    } catch (err) {
      console.error('Failed to fetch input stats:', err)
    }
  }

  /**
   * Select a file
   */
  const selectFile = (file: File | null): void => {
    selectedFile.value = file
  }

  /**
   * Clear selection
   */
  const clearSelection = (): void => {
    selectedFile.value = null
  }

  /**
   * Get all image files
   */
  const imageFiles = computed(() =>
    files.value.filter(f => f.type === 'photo')
  )

  /**
   * Get all video files
   */
  const videoFiles = computed(() =>
    files.value.filter(f => f.type === 'video')
  )

  /**
   * Get all unknown files
   */
  const unknownFiles = computed(() =>
    files.value.filter(f => f.type === 'unknown')
  )

  return {
    files,
    selectedFile,
    loading,
    error,
    inputStats,
    fetchInputFiles,
    fetchInputStats,
    selectFile,
    clearSelection,
    imageFiles,
    videoFiles,
    unknownFiles,
  }
})
