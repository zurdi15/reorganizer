import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useWebSocket } from '../useWebSocket'
import { useInputStore } from '@/stores/input'
import { useJobsStore } from '@/stores/jobs'
import { useWsStore } from '@/stores/ws'
import type { JobRead } from '@/types/api'

// Mock de WebSocket controlable desde el test: open/fail/message a demanda.
// Reproduce la superficie que usa el composable (readyState, constantes,
// on*, send, close) — nunca red real.
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  url: string
  readyState = MockWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.()
  }

  // -- helpers de test --
  open() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  fail() {
    this.readyState = MockWebSocket.CLOSED
    this.onerror?.()
    this.onclose?.()
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }
}

function jsonResponse(data: unknown): Response {
  return { ok: true, status: 200, json: async () => data } as unknown as Response
}

// happy-dom expone visibilityState como getter; se sobrescribe como propiedad
// propia para simular background/foreground y se restaura a 'visible' (su
// default) tras cada test
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

const runningJob: JobRead = {
  id: 7,
  status: 'running',
  dest_path: '2024/08/croacia',
  transfer_mode: 'move',
  duplicate_strategy: 'rename',
  total: 40,
  done: 12,
  errors: 0,
  skipped: 1,
  error: null,
  immich_status: null,
  created_at: '2026-08-13T10:00:00Z',
  started_at: '2026-08-13T10:01:00Z',
  finished_at: null,
}

describe('useWebSocket', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    // el dispatch de input-changed dispara un refresh del input store
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        jsonResponse(
          url.includes('/input/files')
            ? []
            : url.includes('/input/dates')
              ? { years: [], months_by_year: {} }
              : { photo: 0, video: 0, unknown: 0, total: 0 },
        ),
      ),
    )
    vi.useFakeTimers()
  })

  afterEach(() => {
    // limpia el singleton de módulo (socket/timer/listener de visibility)
    useWebSocket().disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    // deja la pestaña VISIBLE (default) para no contaminar el siguiente test
    setVisibility('visible')
  })

  it('connects to (ws|wss)://host/api/v1/ws and sends {"action":"sync"} on open', async () => {
    const { connect } = useWebSocket()
    const promise = connect()

    expect(MockWebSocket.instances).toHaveLength(1)
    const socket = MockWebSocket.instances[0]
    expect(socket.url).toBe(`ws://${location.host}/api/v1/ws`)

    socket.open()
    await promise

    expect(socket.sent).toEqual(['{"action":"sync"}'])
    expect(useWsStore().connected).toBe(true)
  })

  it('reuses the live socket and the in-flight attempt instead of opening duplicates', async () => {
    const { connect } = useWebSocket()
    const first = connect()
    // en vuelo: misma promesa, mismo socket
    expect(connect()).toBe(first)
    expect(MockWebSocket.instances).toHaveLength(1)

    MockWebSocket.instances[0].open()
    await first

    // ya abierto: resuelve sin crear otro socket
    await connect()
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('dispatches typed messages to the right stores (jobs vs input)', async () => {
    const { connect } = useWebSocket()
    const promise = connect()
    const socket = MockWebSocket.instances[0]
    socket.open()
    await promise

    socket.message({ type: 'state-sync', data: { job: runningJob, events: [] } })
    expect(useJobsStore().activeJob?.id).toBe(7)

    socket.message({ type: 'job-status', data: { job_id: 7, status: 'completed' } })
    expect(useJobsStore().activeJob).toBeNull()

    const counts = { photo: 3, video: 1, unknown: 0, total: 4 }
    socket.message({ type: 'input-changed', data: { counts } })
    expect(useInputStore().summary).toEqual(counts)

    // un mensaje corrupto no tumba nada
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    socket.onmessage?.({ data: '{esto no es json' })
    expect(useJobsStore().activeJob).toBeNull()
    errorSpy.mockRestore()
  })

  it('reconnects with the exponential schedule after losing the connection', async () => {
    const { connect } = useWebSocket()
    const promise = connect()
    MockWebSocket.instances[0].open()
    await promise

    // caída: primer reintento programado a 1s
    MockWebSocket.instances[0].fail()
    expect(useWsStore().connected).toBe(false)
    expect(MockWebSocket.instances).toHaveLength(1)

    vi.advanceTimersByTime(999)
    expect(MockWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(MockWebSocket.instances).toHaveLength(2)

    // el reintento también falla ANTES de abrir: siguiente escalón a 2s
    MockWebSocket.instances[1].fail()
    vi.advanceTimersByTime(1999)
    expect(MockWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(MockWebSocket.instances).toHaveLength(3)
    expect(useWsStore().retryCount).toBe(2)

    // reconexión con éxito → presupuesto restaurado
    MockWebSocket.instances[2].open()
    expect(useWsStore().connected).toBe(true)
    expect(useWsStore().retryCount).toBe(0)
  })

  it('stops rescheduling after the retry budget is exhausted on a HIDDEN tab (only visibilitychange revives)', async () => {
    const { connect } = useWebSocket()
    const promise = connect()
    MockWebSocket.instances[0].open()
    await promise

    // pestaña OCULTA: agotado el presupuesto, se deja morir sin timer — el SO
    // móvil suele matar el socket en background y solo el revival de
    // visibilitychange debe resucitarlo
    setVisibility('hidden')
    useWsStore().retryCount = 10
    MockWebSocket.instances[0].fail()

    expect(vi.getTimerCount()).toBe(0)
    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('keeps a capped retry timer armed on a VISIBLE tab after the budget is exhausted (no permanent disconnect)', async () => {
    const { connect } = useWebSocket()
    const promise = connect()
    MockWebSocket.instances[0].open()
    await promise

    // presupuesto agotado con la pestaña VISIBLE: en vez de morir para
    // siempre, queda un latido al techo del backoff (30s) SIN gastar cuenta
    useWsStore().retryCount = 10
    MockWebSocket.instances[0].fail()

    expect(vi.getTimerCount()).toBe(1)
    expect(useWsStore().retryCount).toBe(10)

    // antes de 30s no reintenta; a los 30s abre un socket nuevo
    vi.advanceTimersByTime(29999)
    expect(MockWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(MockWebSocket.instances).toHaveLength(2)

    // si ese intento también falla, REARMA otro latido al techo (sigue sin
    // gastar presupuesto): una pestaña visible nunca queda desconectada
    MockWebSocket.instances[1].fail()
    expect(vi.getTimerCount()).toBe(1)
    expect(useWsStore().retryCount).toBe(10)
  })

  it('visibilitychange with a dead socket resets the budget and reconnects immediately', async () => {
    const { connect } = useWebSocket()
    const promise = connect()
    MockWebSocket.instances[0].open()
    await promise

    // muere en BACKGROUND (pestaña oculta) y agota los reintentos: sin timer
    setVisibility('hidden')
    useWsStore().retryCount = 10
    MockWebSocket.instances[0].fail()
    expect(vi.getTimerCount()).toBe(0)

    // el usuario vuelve a primer plano
    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(useWsStore().retryCount).toBe(0)
    expect(MockWebSocket.instances).toHaveLength(2)
    MockWebSocket.instances[1].open()
    expect(useWsStore().connected).toBe(true)
  })

  it('visibilitychange with a LIVE socket is a no-op (no duplicate connections)', async () => {
    const { connect } = useWebSocket()
    const promise = connect()
    MockWebSocket.instances[0].open()
    await promise

    document.dispatchEvent(new Event('visibilitychange'))
    expect(MockWebSocket.instances).toHaveLength(1)
  })
})
