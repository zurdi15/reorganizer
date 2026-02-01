import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useFileStore } from '../../stores/fileStore'
import { mockFetch, mockInputFilesResponse } from '../mocks/api'

describe('FileStore', () => {
  beforeEach(() => {
    // Create a fresh Pinia instance for each test
    setActivePinia(createPinia())
  })

  it('initializes with empty files array', () => {
    const store = useFileStore()
    expect(store.files).toEqual([])
    expect(store.selectedFile).toBeNull()
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('fetches input files successfully', async () => {
    const store = useFileStore()
    global.fetch = mockFetch(mockInputFilesResponse)

    await store.fetchInputFiles()

    expect(store.files).toHaveLength(5)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
  })

  it('classifies files by type', async () => {
    const store = useFileStore()
    global.fetch = mockFetch(mockInputFilesResponse)

    await store.fetchInputFiles()

    const photoFiles = store.files.filter(f => f.type === 'photo')
    const videoFiles = store.files.filter(f => f.type === 'video')
    const unknownFiles = store.files.filter(f => f.type === 'unknown')

    expect(photoFiles).toHaveLength(2)
    expect(videoFiles).toHaveLength(2)
    expect(unknownFiles).toHaveLength(1)
  })

  it('computes image files correctly', async () => {
    const store = useFileStore()
    global.fetch = mockFetch(mockInputFilesResponse)

    await store.fetchInputFiles()

    expect(store.imageFiles).toHaveLength(2)
    expect(store.imageFiles.every(f => f.type === 'photo')).toBe(true)
  })

  it('computes video files correctly', async () => {
    const store = useFileStore()
    global.fetch = mockFetch(mockInputFilesResponse)

    await store.fetchInputFiles()

    expect(store.videoFiles).toHaveLength(2)
    expect(store.videoFiles.every(f => f.type === 'video')).toBe(true)
  })

  it('computes unknown files correctly', async () => {
    const store = useFileStore()
    global.fetch = mockFetch(mockInputFilesResponse)

    await store.fetchInputFiles()

    expect(store.unknownFiles).toHaveLength(1)
    expect(store.unknownFiles[0].name).toBe('document.pdf')
  })

  it('selects and deselects files', () => {
    const store = useFileStore()
    const file = {
      name: 'test.jpg',
      type: 'photo' as const,
      extension: 'jpg',
      previewUrl: '/test.jpg',
    }

    store.selectFile(file)
    expect(store.selectedFile).toEqual(file)

    store.clearSelection()
    expect(store.selectedFile).toBeNull()
  })

  it('handles fetch errors', async () => {
    const store = useFileStore()
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    await store.fetchInputFiles()

    expect(store.files).toEqual([])
    expect(store.loading).toBe(false)
    expect(store.error).toBeTruthy()
  })

  it('generates preview URLs correctly', async () => {
    const store = useFileStore()
    global.fetch = mockFetch(['test.jpg'])

    await store.fetchInputFiles()

    expect(store.files[0].previewUrl).toBe('/input/test.jpg')
  })
})
