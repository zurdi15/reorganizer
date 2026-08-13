<script setup lang="ts">
// Control segmentado con indicador deslizante (mover/copiar, estrategia de
// duplicados...). Mismo truco aritmético que el indicador del bottom nav de
// ShellView: segmentos de ancho IGUAL (flex-1), un único indicador absoluto
// de 1/n de ancho que se traslada translateX(index*100%) — transform puro,
// dentro de la disciplina de animación del sistema. Semántica de radiogroup:
// exactamente una opción activa, flechas para moverse.
import { computed } from 'vue'

const props = defineProps<{
  modelValue: string
  options: { value: string; label: string }[]
  // nombre accesible del grupo (los segmentos ya tienen su texto visible)
  label?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const activeIndex = computed(() => {
  const idx = props.options.findIndex((o) => o.value === props.modelValue)
  // sin match (valor todavía sin inicializar): el indicador se esconde en 0
  // vía opacity en vez de plantarse en una posición mentirosa
  return idx === -1 ? 0 : idx
})
const hasMatch = computed(() => props.options.some((o) => o.value === props.modelValue))

function move(delta: number) {
  const idx = activeIndex.value
  const next = props.options[(idx + delta + props.options.length) % props.options.length]
  emit('update:modelValue', next.value)
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="label"
    class="relative flex rounded-sm border border-line bg-void p-1"
    @keydown.arrow-right.prevent="move(1)"
    @keydown.arrow-left.prevent="move(-1)"
  >
    <!-- pista del indicador: inset-1 replica el p-1 del contenedor, así el
         ancho del indicador es un % PLANO de la pista (sin calc) y el
         translateX(index*100%) de su propio ancho cae exacto en cada
         segmento. Indicador SIEMPRE montado (nunca v-if): cruza por
         opacity, y el movimiento entre segmentos es un translate animado,
         no un remonte. -->
    <div class="pointer-events-none absolute inset-1" aria-hidden="true">
      <div
        class="h-full rounded-xs bg-slab border border-line-strong"
        :style="{
          width: `${100 / options.length}%`,
          transform: `translateX(${activeIndex * 100}%)`,
          opacity: hasMatch ? 1 : 0,
          transition: 'transform var(--rg-dur-3) var(--rg-ease-out), opacity var(--rg-dur-2) var(--rg-ease-out)',
        }"
        data-testid="segmented-indicator"
      />
    </div>
    <!-- py-2 + text-sm (20px) + 2×4px del p-1 del contenedor + borde = 40px
         de tap-target: mismo suelo táctil que RgButton md -->
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      role="radio"
      :aria-checked="opt.value === modelValue ? 'true' : 'false'"
      class="relative flex-1 px-2 py-2 text-sm font-display uppercase tracking-wide transition-colors"
      :class="opt.value === modelValue ? 'text-amber' : 'text-ink-faint hover:text-ink'"
      @click="emit('update:modelValue', opt.value)"
    >
      {{ opt.label }}
    </button>
  </div>
</template>
