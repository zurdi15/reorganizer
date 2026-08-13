<script setup lang="ts">
// Campo de texto (plantilla: BkField). La etiqueta vive DENTRO del campo
// como placeholder; el nombre accesible no puede depender solo del
// placeholder (desaparece al escribir y algunos lectores no lo anuncian),
// así que label alimenta también aria-label. mono: rutas/nombres de archivo.
withDefaults(
  defineProps<{
    label: string
    modelValue: string
    type?: 'text' | 'password' | 'number'
    error?: string
    hint?: string
    mono?: boolean
    autocomplete?: string
  }>(),
  { type: 'text' },
)
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div>
    <input
      :value="modelValue"
      :type="type"
      :placeholder="label"
      :aria-label="label"
      :autocomplete="autocomplete"
      :aria-invalid="error ? 'true' : undefined"
      class="rg-form-control w-full rounded-sm border bg-stone px-3 py-2.5 text-ink placeholder:text-ink-faint focus:border-amber"
      :class="[error ? 'border-danger' : 'border-line', mono && 'rg-metric']"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    />
    <span v-if="error" class="block mt-1 text-sm text-danger">{{ error }}</span>
    <span v-else-if="hint" class="block mt-1 text-sm text-ink-faint">{{ hint }}</span>
  </div>
</template>
