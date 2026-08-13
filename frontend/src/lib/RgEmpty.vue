<script setup lang="ts">
// Primitiva de vacío unificada (plantilla: BkEmpty, con RgIcon en vez de
// runa): icono + mensaje + botón de acción OPCIONAL directamente debajo.
import RgButton from './RgButton.vue'
import RgIcon from './RgIcon.vue'
import type { IconName } from './icons'

const props = withDefaults(
  defineProps<{ icon?: IconName; message: string; actionLabel?: string; actionTestid?: string }>(),
  { icon: 'folder' },
)
const emit = defineEmits<{ action: [] }>()
</script>

<template>
  <div class="flex flex-col items-center gap-4 py-10 text-center">
    <RgIcon :name="icon" :size="48" class="text-ink-faint" />
    <p class="text-ink-muted max-w-xs">{{ message }}</p>
    <!-- sin size="sm": el CTA de un estado vacío es el único camino de salida,
         merece el tap-target md por defecto (40px, WCAG 2.5.5/2.5.8) -->
    <RgButton
      v-if="actionLabel"
      variant="primary"
      :data-testid="props.actionTestid ?? 'empty-action-btn'"
      @click="emit('action')"
    >
      {{ actionLabel }}
    </RgButton>
    <slot />
  </div>
</template>
