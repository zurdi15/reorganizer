<script setup lang="ts">
// Grid del input (etapa 1 del flujo Organizar): 3 columnas en móvil / 5 en
// desktop de thumbs cuadrados lazy, strip de aviso si hay archivos sin
// clasificar, refresh manual y estado vacío que cruza a /upload. Tap en una
// celda → sheet de detalle (preview + probe + borrar). El folder puede tener
// miles de archivos: se pagina con scroll infinito (un sentinel bajo la grid
// dispara loadMore cuando entra en viewport).
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import RgButton from '@/lib/RgButton.vue'
import RgEmpty from '@/lib/RgEmpty.vue'
import RgIcon from '@/lib/RgIcon.vue'
import RgSpinner from '@/lib/RgSpinner.vue'
import { useInputStore } from '@/stores/input'
import type { InputFile } from '@/types/api'
import { toastApiError } from '@/utils/apiErrors'

import InputCard from './InputCard.vue'
import InputFileSheet from './InputFileSheet.vue'

const { t } = useI18n()
const router = useRouter()
const input = useInputStore()

const selected = ref<InputFile | null>(null)

function refresh() {
  input.refresh().catch(toastApiError)
}

function goUpload() {
  router.push({ name: 'upload' })
}

// ---- scroll infinito: sentinel + IntersectionObserver ----
// el sentinel vive justo bajo la grid; cuando entra en viewport (con 400px de
// margen para prefetch antes de tocar fondo) y aún quedan páginas, se pide la
// siguiente. root=null → viewport, que aquí es el <main> scroller del shell.
const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function onIntersect(entries: IntersectionObserverEntry[]) {
  if (entries.some((entry) => entry.isIntersecting) && input.hasMore) {
    input.loadMore().catch(toastApiError)
  }
}

onMounted(() => {
  // guard defensivo: en SSR/entornos sin la API el scroll infinito queda
  // inerte (la primera página ya está pintada), nunca revienta el montaje
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(onIntersect, { rootMargin: '400px' })
  if (sentinel.value) observer.observe(sentinel.value)
})

// el sentinel aparece/desaparece con el estado (vacío ↔ con archivos): se
// re-observa cuando el elemento cambia (disconnect purga la observación vieja)
watch(sentinel, (el) => {
  if (!observer) return
  observer.disconnect()
  if (el) observer.observe(el)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- cabecera de la grid: contador de archivos + refresh manual (el WS
         input-changed ya refresca solo; esto es el cinturón y tirantes para
         cuando alguien toca el folder por SSH/Samba) -->
    <div class="flex items-center justify-between gap-3">
      <!-- el contador es el TOTAL real del folder (input.total), no los
           archivos cargados en esta página: con paginación files.length solo
           es la tanda visible, no el recuento verdadero -->
      <span class="rg-metric text-sm text-ink-muted" data-testid="input-count">
        {{ t('organize.fileCount', input.total) }}
      </span>
      <RgButton variant="ghost" size="md" data-testid="input-refresh" :loading="input.loading" @click="refresh">
        {{ t('organize.refresh') }}
      </RgButton>
    </div>

    <!-- strip de aviso: n archivos no clasificables por extensión — al
         organizar irán al fallback _unknown/ (nunca más archivos abandonados
         en silencio) -->
    <div
      v-if="input.summary && input.summary.unknown > 0"
      class="flex items-center gap-2 rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
      data-testid="unknown-strip"
    >
      <RgIcon name="warning" :size="16" class="shrink-0" />
      <span>{{ t('organize.unknownStrip', input.summary.unknown) }}</span>
    </div>

    <!-- primer load: spinner, no el estado vacío en falso -->
    <div v-if="input.loading && !input.loaded" class="flex justify-center py-10">
      <RgSpinner size="lg" />
    </div>

    <RgEmpty
      v-else-if="input.files.length === 0"
      icon="folder-open"
      :message="t('organize.empty')"
      :action-label="t('organize.emptyAction')"
      action-testid="input-empty-upload"
      @action="goUpload"
    />

    <template v-else>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="input-grid">
        <InputCard v-for="file in input.files" :key="file.path" :file="file" @open="selected = file" />
      </div>

      <!-- sentinel del scroll infinito: invisible, solo dispara loadMore al
           entrar en viewport. Se mantiene en el DOM mientras queden páginas -->
      <div v-if="input.hasMore" ref="sentinel" data-testid="input-sentinel" aria-hidden="true" class="h-px w-full" />

      <!-- feedback de "trayendo la siguiente página" bajo la grid -->
      <div
        v-if="input.loadingMore"
        class="flex items-center justify-center gap-2 py-4 text-sm text-ink-muted"
        data-testid="input-loading-more"
      >
        <RgSpinner size="sm" />
        <span>{{ t('organize.loadingMore') }}</span>
      </div>
    </template>

    <InputFileSheet :file="selected" @close="selected = null" />
  </div>
</template>
