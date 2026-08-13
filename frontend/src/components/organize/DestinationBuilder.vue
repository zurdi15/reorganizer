<script setup lang="ts">
// Compositor del destino (la pieza central del flujo Organizar — nunca fuerza
// estructura): un breadcrumb "estás aquí" con los segmentos confirmados como
// chips mono eliminables (+ `..` subir un nivel) SOBRE el navegador del árbol
// real de salida (OutputTreeBrowser: lista visible de subcarpetas + creación
// de carpeta nueva), y debajo la preview de la ruta completa. El detalle de
// carga/filtrado/creación vive en OutputTreeBrowser.vue; aquí solo se orquesta
// la ruta confirmada (store organize) y se muestra dónde estás en el árbol.
import { useI18n } from 'vue-i18n'

import OutputTreeBrowser from './OutputTreeBrowser.vue'
import RgIcon from '@/lib/RgIcon.vue'
import { useOrganizeStore } from '@/stores/organize'

const { t } = useI18n()
const organize = useOrganizeStore()
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- breadcrumb "estás aquí": raíz /output + segmentos confirmados como
         chips mono eliminables + `..` (subir un nivel). Targets ≥40px. -->
    <div class="flex flex-wrap items-center gap-1.5" data-testid="dest-chips">
      <span
        class="rg-metric inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-line bg-void px-2.5 text-sm text-ink-faint"
        data-testid="dest-root"
      >
        <RgIcon name="folder-open" :size="14" />
        {{ t('organize.tree.root') }}
      </span>
      <template v-for="(segment, i) in organize.destSegments" :key="`${i}-${segment}`">
        <span class="text-ink-faint" aria-hidden="true">/</span>
        <button
          type="button"
          class="rg-press rg-metric inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-line bg-void px-2.5 text-sm text-ink hover:border-danger hover:text-danger"
          :aria-label="t('organize.builder.removeSegment', { segment })"
          data-testid="dest-chip"
          @click="organize.removeSegment(i)"
        >
          <span>{{ segment }}</span>
          <RgIcon name="x" :size="12" />
        </button>
      </template>
      <button
        v-if="organize.destSegments.length > 0"
        type="button"
        class="rg-press rg-metric inline-flex min-h-10 items-center rounded-sm border border-line bg-void px-2.5 text-sm text-ink-muted hover:border-line-strong hover:text-ink"
        :aria-label="t('organize.builder.up')"
        data-testid="dest-up"
        @click="organize.removeLastSegment()"
      >
        ..
      </button>
    </div>

    <!-- navegador del árbol real de /output + creación de carpeta nueva -->
    <OutputTreeBrowser />

    <!-- preview de la ruta completa compuesta -->
    <p class="rg-metric break-all text-sm text-ink-muted" data-testid="dest-preview">
      → /output/{{ organize.destPath ? `${organize.destPath}/` : '' }}…
    </p>
  </div>
</template>
