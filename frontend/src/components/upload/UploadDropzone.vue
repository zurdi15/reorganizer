<script setup lang="ts">
// Zona de entrada de archivos, agnóstica de fuente: el <input type="file">
// oculto dispara el selector nativo (accept + multiple = multi-select de
// galería en Android/iOS) y el drag&drop de desktop cae en el mismo emit.
// El control visible es una losa tappable a lo ancho: ~40dvh de diana en el
// estado vacío (la acción con una mano desde el sofá), barra compacta en
// cuanto la cola tiene items.
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RgIcon from '@/lib/RgIcon.vue'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const emit = defineEmits<{ files: [files: File[]] }>()

const { t } = useI18n()
const input = ref<HTMLInputElement | null>(null)

// CONTADOR de dragenter/dragleave, no booleano: cada hijo por el que pasa el
// puntero dispara su propio par enter/leave y un booleano parpadearía
// (guard anti-flicker clásico)
const dragDepth = ref(0)
const dragging = computed(() => dragDepth.value > 0)

// solo reaccionar a arrastres que traen ARCHIVOS (no texto/selecciones)
function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragEnter(event: DragEvent) {
  if (!hasFiles(event)) return
  dragDepth.value++
}

function onDragLeave(event: DragEvent) {
  if (!hasFiles(event)) return
  dragDepth.value = Math.max(0, dragDepth.value - 1)
}

function onDrop(event: DragEvent) {
  dragDepth.value = 0
  const files = Array.from(event.dataTransfer?.files ?? [])
  if (files.length > 0) emit('files', files)
}

function onPick(event: Event) {
  const el = event.target as HTMLInputElement
  const files = Array.from(el.files ?? [])
  if (files.length > 0) emit('files', files)
  // reset SIEMPRE: sin esto, volver a elegir exactamente el mismo archivo no
  // dispara change (lección turtletrips/UploadButton)
  el.value = ''
}
</script>

<template>
  <div
    class="relative"
    :data-dragging="dragging || undefined"
    data-testid="dropzone"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <input
      ref="input"
      data-testid="dropzone-input"
      type="file"
      accept="image/*,video/*"
      multiple
      class="hidden"
      @change="onPick"
    />
    <button
      type="button"
      data-testid="dropzone-button"
      class="rg-press w-full rounded-md border-2 border-dashed transition-colors"
      :class="[
        dragging ? 'border-amber text-amber' : 'border-line-strong text-ink-muted hover:border-amber hover:text-ink',
        props.compact
          ? 'flex items-center justify-center gap-2 px-4 py-3'
          : 'flex flex-col items-center justify-center gap-3 p-6',
      ]"
      :style="props.compact ? undefined : { minHeight: '40dvh' }"
      @click="input?.click()"
    >
      <template v-if="props.compact">
        <RgIcon name="upload" :size="20" />
        <span class="font-display text-sm uppercase tracking-wide">{{ t('upload.dropzone.addMore') }}</span>
      </template>
      <template v-else>
        <RgIcon name="upload" :size="48" />
        <span class="font-display font-semibold uppercase tracking-wide">{{ t('upload.dropzone.cta') }}</span>
        <span class="hidden text-sm text-ink-faint sm:block">{{ t('upload.dropzone.hint') }}</span>
      </template>
    </button>
    <!-- glow ámbar mientras se arrastra CON archivos por encima (mismo halo
         tokenizado que el slab CTA del nav) -->
    <span
      v-if="dragging"
      class="pointer-events-none absolute inset-0 rounded-md shadow-(--rg-shadow-amber)"
      aria-hidden="true"
      data-testid="dropzone-glow"
    />
  </div>
</template>
