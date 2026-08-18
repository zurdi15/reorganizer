<script setup lang="ts">
// Celda de la grid del input: thumb cuadrado + badge de kind superpuesto.
// El lenguaje de color del sistema aplicado: foto↔ámbar / vídeo↔cobalto /
// unknown↔danger. La celda ENTERA es el botón (target táctil generoso,
// ≥40px de sobra con 3 columnas en móvil) y abre la sheet de detalle.
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { inputThumbUrl } from '@/api/input'
import RgBadge from '@/lib/RgBadge.vue'
import RgIcon from '@/lib/RgIcon.vue'
import type { IconName } from '@/lib/icons'
import type { InputFile, MediaKind } from '@/types/api'

const props = defineProps<{ file: InputFile }>()
const emit = defineEmits<{ open: [] }>()

const { t } = useI18n()

const KIND_ICONS: Record<MediaKind, IconName> = {
  photo: 'photo',
  video: 'video',
  // no hay icono genérico de "archivo" en el set: warning comunica lo
  // mismo que el strip de la grid (esto irá a _unknown/)
  unknown: 'warning',
}

// el server solo genera miniaturas de foto y vídeo; para unknown ni se
// intenta (sería un 404 seguro). Y si una thumb falla igualmente
// (ThumbUnavailable → 404), la celda cae al icono en vez de al icono roto
// del navegador.
const thumbFailed = ref(false)
watch(
  () => props.file.path,
  () => {
    thumbFailed.value = false
  },
)

const showThumb = computed(() => props.file.kind !== 'unknown' && !thumbFailed.value)

// nombres de archivo SIEMPRE como texto/atributo vía binding (anti-XSS):
// jamás concatenados en HTML
const label = computed(() => `${props.file.name} · ${t(`organize.kinds.${props.file.kind}`)}`)
</script>

<template>
  <button
    type="button"
    class="rg-cv-card rg-press relative aspect-square w-full overflow-hidden rounded-sm border border-line bg-stone"
    :aria-label="label"
    data-testid="input-card"
    @click="emit('open')"
  >
    <img
      v-if="showThumb"
      :src="inputThumbUrl(file.path)"
      :alt="''"
      loading="lazy"
      class="h-full w-full object-cover"
      data-testid="input-card-thumb"
      @error="thumbFailed = true"
    />
    <span v-else class="flex h-full w-full items-center justify-center text-ink-faint">
      <RgIcon :name="KIND_ICONS[file.kind]" :size="28" />
    </span>
    <!-- badge de kind: esquina inferior izquierda, solo icono (el nombre ya
         va en el aria-label; en celdas de ~110px el texto no cabe) -->
    <span class="absolute bottom-1 left-1">
      <RgBadge :variant="file.kind" data-testid="input-card-badge">
        <RgIcon :name="KIND_ICONS[file.kind]" :size="12" />
      </RgBadge>
    </span>
  </button>
</template>
