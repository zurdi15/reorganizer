import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { File, Position } from '../types/index'

export const usePreviewStore = defineStore('preview', () => {
  const currentFile = ref<File | null>(null)
  const position = ref<Position>({ x: 0, y: 0 })
  const isLoading = ref(false)
  const isVisible = ref(false)
  const error = ref<string | null>(null)

  /**
   * Show file preview
   */
  const showPreview = (file: File): void => {
    currentFile.value = file
    isVisible.value = true
    isLoading.value = true
    error.value = null
  }

  /**
   * Hide file preview
   */
  const hidePreview = (): void => {
    currentFile.value = null
    isVisible.value = false
    isLoading.value = false
    error.value = null
  }

  /**
   * Update preview position
   */
  const updatePosition = (x: number, y: number): void => {
    position.value = { x, y }
  }

  /**
   * Set loading state
   */
  const setLoading = (loading: boolean): void => {
    isLoading.value = loading
  }

  /**
   * Set error message
   */
  const setError = (errorMessage: string | null): void => {
    error.value = errorMessage
  }

  return {
    currentFile,
    position,
    isLoading,
    isVisible,
    error,
    showPreview,
    hidePreview,
    updatePosition,
    setLoading,
    setError,
  }
})
