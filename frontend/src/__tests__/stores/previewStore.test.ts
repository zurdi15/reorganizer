import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePreviewStore } from '../../stores/previewStore'
import type { File } from '../../types/index'

describe('PreviewStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const mockFile: File = {
    name: 'test.jpg',
    type: 'photo',
    extension: 'jpg',
    previewUrl: '/input/test.jpg',
  }

  it('initializes with correct default state', () => {
    const store = usePreviewStore()
    expect(store.currentFile).toBeNull()
    expect(store.position).toEqual({ x: 0, y: 0 })
    expect(store.isLoading).toBe(false)
    expect(store.isVisible).toBe(false)
    expect(store.error).toBeNull()
  })

  it('shows file preview', () => {
    const store = usePreviewStore()
    store.showPreview(mockFile)

    expect(store.currentFile).toEqual(mockFile)
    expect(store.isVisible).toBe(true)
    expect(store.isLoading).toBe(true)
    expect(store.error).toBeNull()
  })

  it('hides file preview', () => {
    const store = usePreviewStore()
    store.showPreview(mockFile)
    expect(store.isVisible).toBe(true)

    store.hidePreview()

    expect(store.currentFile).toBeNull()
    expect(store.isVisible).toBe(false)
    expect(store.isLoading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('updates preview position', () => {
    const store = usePreviewStore()
    store.updatePosition(100, 200)

    expect(store.position).toEqual({ x: 100, y: 200 })
  })

  it('sets loading state', () => {
    const store = usePreviewStore()
    store.setLoading(true)
    expect(store.isLoading).toBe(true)

    store.setLoading(false)
    expect(store.isLoading).toBe(false)
  })

  it('sets error message', () => {
    const store = usePreviewStore()
    store.setError('Load error')
    expect(store.error).toBe('Load error')

    store.setError(null)
    expect(store.error).toBeNull()
  })

  it('clears everything on hide', () => {
    const store = usePreviewStore()
    store.showPreview(mockFile)
    store.updatePosition(100, 200)
    store.setError('Some error')

    store.hidePreview()

    expect(store.currentFile).toBeNull()
    expect(store.isVisible).toBe(false)
    expect(store.isLoading).toBe(false)
    expect(store.error).toBeNull()
  })
})
