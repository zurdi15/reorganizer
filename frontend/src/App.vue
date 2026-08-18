<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useWakeLock } from '@/composables/useWakeLock'
import { useWebSocket } from '@/composables/useWebSocket'
import RgToast from '@/lib/RgToast.vue'
import { useUploadsStore } from '@/stores/uploads'

const { connect } = useWebSocket()

// wake lock GLOBAL: la pantalla no se apaga mientras haya una subida en curso,
// estés en la vista que estés (las subidas siguen en background al navegar).
// Aquí, en App.vue (siempre montado), y no en UploadView, que se desmonta al
// cambiar de sección y soltaría el lock a media subida.
const uploads = useUploadsStore()
useWakeLock(computed(() => uploads.active))

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
