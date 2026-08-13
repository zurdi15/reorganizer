<script setup lang="ts">
// Barra de progreso (planning/ejecución de jobs, subidas). La barra escala
// con transform (scaleX + origin-left), nunca con width: transform es
// composited y no relayouta — la única propiedad animada, dentro de la
// disciplina transform/opacity del sistema. Etiqueta % opcional en mono
// (tabular-nums: no baila al cambiar de dígitos).
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ value: number; max?: number; label?: boolean }>(),
  { max: 100, label: false },
)

const fraction = computed(() => {
  if (!Number.isFinite(props.value) || props.max <= 0) return 0
  return Math.min(1, Math.max(0, props.value / props.max))
})
const percent = computed(() => Math.round(fraction.value * 100))
</script>

<template>
  <div class="flex items-center gap-3">
    <div
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      class="h-2 flex-1 overflow-hidden rounded-full border border-line bg-void"
    >
      <div
        class="h-full w-full rounded-full bg-amber"
        :style="{
          transform: `scaleX(${fraction})`,
          transformOrigin: 'left',
          transition: 'transform var(--rg-dur-2) var(--rg-ease-out)',
        }"
        data-testid="progress-bar"
      />
    </div>
    <span v-if="label" class="rg-metric shrink-0 text-sm text-ink-muted">{{ percent }}%</span>
  </div>
</template>
