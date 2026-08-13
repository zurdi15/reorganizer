import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useWsStore } from '../ws'

describe('stores/ws', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('produces the full backoff schedule: 1s base ×2 per attempt, capped at 30s, 10 retries max', () => {
    const ws = useWsStore()
    const delays: number[] = []
    while (ws.shouldRetry) {
      delays.push(ws.retryDelay)
      ws.incrementRetry()
    }
    expect(delays).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000,
    ])
    expect(ws.retryCount).toBe(10)
    expect(ws.shouldRetry).toBe(false)
  })

  it('setConnected(true) restores the retry budget; setConnected(false) does not touch it', () => {
    const ws = useWsStore()
    ws.incrementRetry()
    ws.incrementRetry()
    ws.incrementRetry()
    expect(ws.retryCount).toBe(3)

    // una desconexión NO resetea (el backoff sigue creciendo entre intentos)
    ws.setConnected(false)
    expect(ws.retryCount).toBe(3)

    ws.setConnected(true)
    expect(ws.connected).toBe(true)
    expect(ws.retryCount).toBe(0)
    expect(ws.retryDelay).toBe(1000)
  })

  it('resetRetry re-arms the budget after exhaustion (the visibilitychange revival path)', () => {
    const ws = useWsStore()
    for (let i = 0; i < 10; i++) ws.incrementRetry()
    expect(ws.shouldRetry).toBe(false)

    ws.resetRetry()
    expect(ws.shouldRetry).toBe(true)
    expect(ws.retryDelay).toBe(1000)
  })
})
