import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { File, FileType } from '../types/index'

export const useFileStore = defineStore('file', () => {
  const files = ref<File[]>([])
  const selectedFile = ref<File | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * Fetch input files from the server
   */
  const fetchInputFiles = async (): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const baseUrl = import.meta.env.DEV ? 'http://localhost:3334' : ''
      const response = await fetch(`${baseUrl}/api/input`, {
        headers: { 'Accept': 'application/json' }
      })
      const data: string[] = await response.json()

      files.value = data.map(fileName => {
        const extension = fileName.split('.').pop()?.toLowerCase() || ''
        const pictureExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tiff']
        const videoExtensions = ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv']

        let type: FileType = 'unknown' as FileType
        if (pictureExtensions.includes(extension)) {
          type = 'photo' as FileType
        } else if (videoExtensions.includes(extension)) {
          type = 'video' as FileType
        }

        const baseUrl = import.meta.env.DEV ? 'http://localhost:3334' : ''
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
    fetchInputFiles,
    selectFile,
    clearSelection,
    imageFiles,
    videoFiles,
    unknownFiles,
  }
})
