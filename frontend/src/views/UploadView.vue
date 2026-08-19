<script setup lang="ts">
// Vista Subir (fase 11, feature estrella) — SOLO composición: la lógica de
// cola vive en stores/uploads (agnóstica de vista: al navegar, las subidas
// siguen y el slab CTA del nav muestra el lote). Dropzone → cola → resumen.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import UploadDropzone from '@/components/upload/UploadDropzone.vue'
import UploadQueueItem from '@/components/upload/UploadQueueItem.vue'
import UploadSummary from '@/components/upload/UploadSummary.vue'
import { useVirtualRows } from '@/composables/useVirtualRows'
import { useUploadsStore } from '@/stores/uploads'

// Alto de una fila de la cola (h-18 = 72px con su borde) como ESTIMACIÓN
// inicial: el composable lo corrige midiendo la primera fila pintada, que es
// lo que salva el caso de otra tipografía base (las alturas van en rem). Lo
// que sí es contrato es que TODAS las filas midan igual — de ahí el alto fijo
// de UploadQueueItem y su test.
const ROW_HEIGHT_PX = 72

const { t } = useI18n()
const uploads = useUploadsStore()

// el wake lock (pantalla encendida durante las subidas) vive AHORA en App.vue,
// global: así sigue activo aunque navegues fuera de esta vista mientras sube

const hasItems = computed(() => uploads.items.length > 0)

// Ventana de render: con 2000 ficheros en cola, montar 2000 filas cuesta caro
// (crear los componentes y su DOM es justo lo que content-visibility NO
// ahorra) y además se queda en memoria. Aquí se montan solo las visibles más
// un margen; por debajo del umbral del composable la lista va entera, como
// siempre.
const itemCount = computed(() => uploads.items.length)
const { listEl, start, end, padTop, padBottom } = useVirtualRows(itemCount, {
  rowHeight: ROW_HEIGHT_PX,
})
const visibleItems = computed(() => uploads.items.slice(start.value, end.value))
</script>

<template>
  <section>
    <h1 class="font-display font-semibold uppercase tracking-wider text-lg mb-4">
      {{ t('upload.title') }}
    </h1>

    <!-- losa grande de estado vacío; barra compacta en cuanto hay cola -->
    <UploadDropzone :compact="hasItems" @files="uploads.enqueue" />

    <!-- el padding de arriba y abajo reserva el hueco de las filas NO montadas:
         el alto total de la lista y la barra de scroll siguen siendo los de la
         cola completa -->
    <ul
      v-if="hasItems"
      ref="listEl"
      class="mt-4"
      :style="{ paddingTop: `${padTop}px`, paddingBottom: `${padBottom}px` }"
      data-testid="upload-queue"
    >
      <UploadQueueItem
        v-for="item in visibleItems"
        :key="item.id"
        :item="item"
        @retry="uploads.retry"
        @cancel="uploads.cancel"
      />
    </ul>

    <UploadSummary v-if="hasItems" class="mt-4" />
  </section>
</template>
