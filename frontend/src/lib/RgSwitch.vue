<script setup lang="ts">
// Interruptor accesible (role=switch): track + bolita trasladada con
// transform puro. Etiqueta visible a la izquierda, el switch a la derecha —
// fila completa clicable de ≥40px de alto (suelo táctil del sistema).
defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue ? 'true' : 'false'"
    :disabled="disabled || undefined"
    class="flex w-full items-center justify-between gap-3 py-2 text-left disabled:opacity-50"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="text-sm text-ink">{{ label }}</span>
    <span
      class="relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border transition-colors"
      :class="modelValue ? 'border-amber bg-amber-deep' : 'border-line-strong bg-slab'"
      aria-hidden="true"
    >
      <span
        class="absolute h-4 w-4 rounded-full transition-transform"
        :class="modelValue ? 'bg-void' : 'bg-ink-muted'"
        :style="{
          left: '0.2rem',
          transform: modelValue ? 'translateX(1rem)' : 'translateX(0)',
          transition: 'transform var(--rg-dur-2) var(--rg-ease-out), background-color var(--rg-dur-2) var(--rg-ease-out)',
        }"
      />
    </span>
  </button>
</template>
