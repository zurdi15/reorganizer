import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProcessingStore } from '../../stores/processingStore'

describe('ProcessingStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes with correct default state', () => {
    const store = useProcessingStore()
    expect(store.isProcessing).toBe(false)
    expect(store.stats.total).toBe(0)
    expect(store.stats.processed).toBe(0)
    expect(store.stats.pictures).toBe(0)
    expect(store.stats.videos).toBe(0)
    expect(store.stats.unknown).toBe(0)
    expect(store.stats.errors).toBe(0)
    expect(store.logs).toEqual([])
    expect(store.errors).toEqual([])
  })

  it('starts processing', () => {
    const store = useProcessingStore()
    store.startProcessing()
    expect(store.isProcessing).toBe(true)
  })

  it('stops processing', () => {
    const store = useProcessingStore()
    store.startProcessing()
    expect(store.isProcessing).toBe(true)

    store.stopProcessing()
    expect(store.isProcessing).toBe(false)
  })

  it('resets state for new job', () => {
    const store = useProcessingStore()
    store.addLog('old log')
    store.addError('old error')
    store.updateStats({ total: 5, processed: 3 })

    store.resetForNewJob()

    expect(store.isProcessing).toBe(true)
    expect(store.logs).toEqual([])
    expect(store.errors).toEqual([])
    expect(store.stats.total).toBe(0)
    expect(store.stats.processed).toBe(0)
  })

  it('applies state sync from server', () => {
    const store = useProcessingStore()

    store.applyStateSync({
      status: 'processing',
      stats: { total: 20, processed: 10, pictures: 6, videos: 3, unknown: 1, errors: 0 },
      logs: ['log1', 'log2'],
      errors: [],
      output_path: '2024/08/trip',
    })

    expect(store.isProcessing).toBe(true)
    expect(store.stats.total).toBe(20)
    expect(store.stats.processed).toBe(10)
    expect(store.stats.pictures).toBe(6)
    expect(store.logs).toEqual(['log1', 'log2'])
  })

  it('applies state sync for idle status', () => {
    const store = useProcessingStore()
    store.startProcessing()

    store.applyStateSync({
      status: 'idle',
      stats: { total: 0, processed: 0, pictures: 0, videos: 0, unknown: 0, errors: 0 },
      logs: [],
      errors: [],
      output_path: '',
    })

    expect(store.isProcessing).toBe(false)
  })

  it('updates stats partially', () => {
    const store = useProcessingStore()
    store.updateStats({ total: 10, pictures: 5 })

    expect(store.stats.total).toBe(10)
    expect(store.stats.pictures).toBe(5)
    expect(store.stats.videos).toBe(0)
  })

  it('adds logs', () => {
    const store = useProcessingStore()
    store.addLog('Log entry 1')
    store.addLog('Log entry 2')

    expect(store.logs).toHaveLength(2)
    expect(store.logs[0]).toBe('Log entry 1')
  })

  it('adds errors and increments error count', () => {
    const store = useProcessingStore()
    store.addError('Error 1')
    store.addError('Error 2')

    expect(store.errors).toHaveLength(2)
    expect(store.stats.errors).toBe(2)
  })

  it('clears logs and errors', () => {
    const store = useProcessingStore()
    store.addLog('Log')
    store.addError('Error')

    store.clearLogs()

    expect(store.logs).toEqual([])
    expect(store.errors).toEqual([])
  })

  it('calculates completion percentage correctly', () => {
    const store = useProcessingStore()
    store.updateStats({ total: 10, processed: 5 })

    expect(store.completionPercentage).toBe(50)

    store.updateStats({ processed: 10 })
    expect(store.completionPercentage).toBe(100)

    store.updateStats({ total: 0, processed: 0 })
    expect(store.completionPercentage).toBe(0)
  })

  it('detects errors correctly', () => {
    const store = useProcessingStore()
    expect(store.hasErrors).toBe(false)

    store.addError('Error 1')
    expect(store.hasErrors).toBe(true)
  })
})
