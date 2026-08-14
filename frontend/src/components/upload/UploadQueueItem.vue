<script setup lang="ts">
// Fila de la cola de subida: miniatura 56px (objectURL para imágenes; icono
// para vídeo/otros — sin extracción de frames en cliente), nombre mono
// truncado POR EL MEDIO (el final del nombre es lo que distingue los
// sufijos numerados), tamaño humano, progreso por bytes y acciones SIEMPRE
// visibles con diana ≥40px — nada solo-hover: esto se usa con el pulgar.
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import RgButton from '@/lib/RgButton.vue'
import RgIcon from '@/lib/RgIcon.vue'
import RgProgress from '@/lib/RgProgress.vue'
import type { UploadItem } from '@/stores/uploads'
import { formatBytes, middleTruncate } from '@/utils/format'

const props = defineProps<{ item: UploadItem }>()
const emit = defineEmits<{ retry: [id: number]; cancel: [id: number] }>()

const { t, te } = useI18n()

// (ya no hay aviso de "archivo grande": la subida por trozos reanudable hace
// que los archivos de varios GB suban de forma fiable — el tamaño se muestra
// como en cualquier archivo)
const shownName = computed(() => middleTruncate(props.item.name, 34))

const errorText = computed(() => {
  const slug = props.item.errorSlug
  const key = `errors.${slug ?? 'generic'}`
  return te(key) ? t(key) : t('errors.generic')
})
</script>

<template>
  <li class="flex items-center gap-3 py-2" :data-status="item.status">
    <!-- miniatura 56px: imagen real solo si hay objectURL (kind image) -->
    <div
      class="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-stone"
    >
      <img
        v-if="item.objectUrl"
        :src="item.objectUrl"
        alt=""
        class="h-full w-full object-cover"
        data-testid="item-thumb"
      />
      <RgIcon
        v-else
        :name="item.kind === 'video' ? 'video' : 'file'"
        :size="24"
        class="text-ink-faint"
        data-testid="item-glyph"
      />
    </div>

    <div class="min-w-0 flex-1">
      <!-- title con el nombre COMPLETO: el truncado es solo visual -->
      <p class="rg-metric truncate text-sm text-ink" :title="item.name" data-testid="item-name">
        {{ shownName }}
      </p>
      <div class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <span class="rg-metric">{{ formatBytes(item.size) }}</span>
        <span v-if="item.status === 'canceled'" class="text-ink-faint" data-testid="item-canceled">
          {{ t('upload.queue.canceled') }}
        </span>
        <!-- saltado: no se subió porque ese nombre ya estaba en la bandeja
             (ajuste de duplicados de subida) — informativo, no un error -->
        <span v-else-if="item.status === 'skipped'" class="text-ink-faint" data-testid="item-skipped">
          {{ t('upload.queue.skipped') }}
        </span>
      </div>
      <RgProgress
        v-if="item.status === 'uploading'"
        class="mt-1.5"
        :value="item.progress * 100"
      />
      <p v-else-if="item.status === 'error'" class="mt-0.5 text-xs text-danger" data-testid="item-error">
        {{ errorText }}
      </p>
    </div>

    <!-- estado + acciones: ghost buttons ≥40px SIEMPRE visibles -->
    <div class="flex shrink-0 items-center gap-1.5">
      <RgIcon
        v-if="item.status === 'queued'"
        name="clock"
        class="text-ink-faint"
        data-testid="status-queued"
      />
      <RgIcon
        v-else-if="item.status === 'done'"
        name="check"
        class="text-ok"
        data-testid="status-done"
      />
      <!-- el saltado también está resuelto: mismo check, pero apagado — no
           es una subida celebrable ni un fallo -->
      <RgIcon
        v-else-if="item.status === 'skipped'"
        name="check"
        class="text-ink-faint"
        data-testid="status-skipped"
      />
      <RgIcon
        v-else-if="item.status === 'error'"
        name="warning"
        class="text-danger"
        data-testid="status-error"
      />
      <RgButton
        v-if="item.status === 'error' || item.status === 'canceled'"
        variant="ghost"
        size="md"
        :aria-label="t('common.retry')"
        data-testid="retry-btn"
        @click="emit('retry', item.id)"
      >
        <RgIcon name="refresh" :size="18" />
      </RgButton>
      <RgButton
        v-if="item.status === 'queued' || item.status === 'uploading'"
        variant="ghost"
        size="md"
        :aria-label="t('common.cancel')"
        data-testid="cancel-btn"
        @click="emit('cancel', item.id)"
      >
        <RgIcon name="x" :size="18" />
      </RgButton>
    </div>
  </li>
</template>
