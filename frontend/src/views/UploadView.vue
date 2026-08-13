<script setup lang="ts">
// Vista Subir (fase 11, feature estrella) — SOLO composición: la lógica de
// cola vive en stores/uploads (agnóstica de vista: al navegar, las subidas
// siguen y el slab CTA del nav muestra el lote). Dropzone → cola → resumen.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import UploadDropzone from '@/components/upload/UploadDropzone.vue'
import UploadQueueItem from '@/components/upload/UploadQueueItem.vue'
import UploadSummary from '@/components/upload/UploadSummary.vue'
import { useWakeLock } from '@/composables/useWakeLock'
import { useUploadsStore } from '@/stores/uploads'

const { t } = useI18n()
const uploads = useUploadsStore()

// pantalla encendida mientras el lote sube (mejora progresiva; el watch del
// composable la libera solo al drenar la cola)
useWakeLock(computed(() => uploads.active))

const hasItems = computed(() => uploads.items.length > 0)
</script>

<template>
  <section>
    <h1 class="font-display font-semibold uppercase tracking-wider text-lg mb-4">
      {{ t('upload.title') }}
    </h1>

    <!-- losa grande de estado vacío; barra compacta en cuanto hay cola -->
    <UploadDropzone :compact="hasItems" @files="uploads.enqueue" />

    <ul v-if="hasItems" class="mt-4 divide-y divide-line" data-testid="upload-queue">
      <UploadQueueItem
        v-for="item in uploads.items"
        :key="item.id"
        :item="item"
        @retry="uploads.retry"
        @cancel="uploads.cancel"
      />
    </ul>

    <UploadSummary v-if="hasItems" class="mt-4" />
  </section>
</template>
