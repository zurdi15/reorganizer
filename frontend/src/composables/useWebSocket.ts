import { computed } from 'vue'

import { useInputStore } from '@/stores/input'
import { useJobsStore } from '@/stores/jobs'
import { useWsStore } from '@/stores/ws'
import type { WsMessage } from '@/types/api'

// Singleton de WebSocket (adaptación del useWebSocket del Reorganizer viejo,
// cuyo esqueleto de reconexión ya estaba probado). Cambios del plan 2.0:
//   - URL SIEMPRE location.host (muere el hardcode localhost:3334): en dev
//     el proxy de Vite cubre /api con ws:true, en prod sirve el backend.
//   - dispatch TIPADO a stores (jobs para job/plan/immich, input para
//     input-changed) — sin registro de callbacks: los interesados leen los
//     stores, no el socket.
//   - push-only: el único mensaje saliente es {"action":"sync"} al abrir,
//     que pide al server el state-sync de restauración.
//   - revival en visibilitychange: los SO móviles matan sockets en
//     background; sin esto, el cap de 10 reintentos dejaría colgado al
//     usuario que vuelve a la app horas después.
//
// Estado a nivel de módulo: TODAS las llamadas a useWebSocket() comparten
// socket, timer y promesa en vuelo.
let socket: WebSocket | null = null
let pending: Promise<void> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let detachVisibility: (() => void) | null = null

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/api/v1/ws`
}

export function useWebSocket() {
  // stores resueltos al invocar el composable (pinia activa) y capturados
  // por las closures de handlers/timers
  const wsStore = useWsStore()
  const jobs = useJobsStore()
  const input = useInputStore()

  function dispatch(raw: unknown) {
    let message: WsMessage
    try {
      message = JSON.parse(String(raw)) as WsMessage
    } catch {
      // un mensaje corrupto no debe tumbar el socket ni la app
      console.error('WebSocket: mensaje no parseable', raw)
      return
    }
    if (message.type === 'input-changed') {
      input.applyInputChanged(message.data.counts)
    } else {
      // todo lo demás es del dominio jobs (state-sync/job-status/
      // plan-progress/item-done/job-error/immich); su switch ignora tipos
      // desconocidos, así que un mensaje futuro no rompe clientes viejos
      jobs.applyWsMessage(message)
    }
  }

  function connect(): Promise<void> {
    if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve()
    if (pending) return pending

    ensureVisibilityHook()

    let ws: WebSocket
    try {
      ws = new WebSocket(wsUrl())
    } catch (error) {
      return Promise.reject(error)
    }
    socket = ws

    pending = new Promise((resolve, reject) => {
      ws.onopen = () => {
        wsStore.setConnected(true)
        // pedir el state-sync de restauración: el server responde con el job
        // vivo + replay del ring de eventos
        ws.send(JSON.stringify({ action: 'sync' }))
        pending = null
        resolve()
      }
      ws.onmessage = (event) => dispatch(event.data)
      ws.onerror = () => {
        // el onclose que sigue es quien limpia y reprograma; aquí solo se
        // corta la espera de quien llamó a connect()
        if (pending) {
          pending = null
          reject(new Error('websocket_error'))
        }
      }
      ws.onclose = () => {
        wsStore.setConnected(false)
        if (socket === ws) socket = null
        if (pending) {
          pending = null
          reject(new Error('websocket_closed'))
        }
        scheduleReconnect()
      }
    })
    return pending
  }

  function scheduleReconnect() {
    if (reconnectTimer) return
    if (!wsStore.shouldRetry) {
      // presupuesto agotado. Con la pestaña OCULTA se deja morir: el SO móvil
      // suele matar el socket en background y solo el revival de
      // visibilitychange (volver a primer plano) debe resucitarlo. Pero con la
      // pestaña VISIBLE no hay ese evento futuro que dispare la reconexión —
      // dejarlo muerto clava al usuario mirando una app desconectada para
      // siempre. Se mantiene un latido al TECHO del backoff (retryDelay ya
      // está saturado a 30s con el presupuesto gastado) SIN gastar más cuenta,
      // y visibilitychange sigue reseteando el presupuesto para un intento ya.
      if (document.visibilityState !== 'visible') return
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect().catch(() => {})
      }, wsStore.retryDelay)
      return
    }
    const delay = wsStore.retryDelay
    wsStore.incrementRetry()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect().catch(() => {
        // el fallo ya reprogramó el siguiente intento vía onclose
      })
    }, delay)
  }

  function ensureVisibilityHook() {
    if (detachVisibility) return
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (socket && socket.readyState === WebSocket.OPEN) return
      // vuelta a primer plano con socket muerto: presupuesto de reintentos
      // restaurado y reconexión INMEDIATA (sin esperar el backoff pendiente)
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      wsStore.resetRetry()
      connect().catch(() => {
        // si también falla, el ciclo normal de backoff ya quedó reprogramado
      })
    }
    document.addEventListener('visibilitychange', onVisibility)
    detachVisibility = () => document.removeEventListener('visibilitychange', onVisibility)
  }

  // cierre limpio (tests y hot-reload; la app real no desconecta nunca)
  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    detachVisibility?.()
    detachVisibility = null
    pending = null
    if (socket) {
      // sin handler de close: un disconnect voluntario no debe reprogramar
      socket.onclose = null
      socket.close()
      socket = null
    }
    wsStore.setConnected(false)
  }

  const isConnected = computed(() => wsStore.connected)

  return { connect, disconnect, isConnected }
}
