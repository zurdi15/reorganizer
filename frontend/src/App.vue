<script setup lang="ts">
import { onMounted } from 'vue'

import { useWebSocket } from '@/composables/useWebSocket'
import RgToast from '@/lib/RgToast.vue'

const { connect } = useWebSocket()

onMounted(() => {
  // conexión WS a nivel de app: viva durante toda la sesión (push-only, el
  // server manda state-sync al abrir). En tests no se auto-conecta: cada
  // spec decide cuándo y con qué mock de WebSocket — nunca red real.
  if (import.meta.env.MODE !== 'test') {
    connect().catch(() => {
      // el primer intento puede fallar (server arrancando): el ciclo de
      // backoff del composable ya queda a cargo de reintentar
    })
  }
})
</script>

<template>
  <RouterView />
  <RgToast />
</template>
