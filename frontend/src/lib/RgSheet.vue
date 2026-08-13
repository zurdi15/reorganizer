<script setup lang="ts">
// Bottom sheet (plantilla: BkSheet) — el patrón de overlay canónico de la
// app: cajón inferior, nunca modales centrados (disciplina mobile-first).
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { isTopLayer, popLayer, pushLayer } from './layerStack'

const props = defineProps<{ open: boolean; title?: string }>()
const emit = defineEmits<{ close: [] }>()

const id = Symbol()
const titleId = useId()
const panel = ref<HTMLElement | null>(null)
let lastFocused: HTMLElement | null = null

// selector de descendientes ENFOCABLES del panel (los estándar tabbables;
// tabindex="-1" queda fuera a propósito: es enfocable por script pero no por
// Tab, como el propio panel)
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// trampa de foco: role=dialog aria-modal no impide que Tab escape a la página
// de detrás. Con este sheet como capa de tope, Tab cicla dentro del panel
// (Shift+Tab del primero → último; Tab del último → primero).
function trapTab(event: KeyboardEvent) {
  const root = panel.value
  if (!root) return
  const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  // panel sin nada enfocable dentro: el foco se queda en el propio panel
  // (tabindex -1) en vez de escapar detrás del scrim
  if (focusables.length === 0) {
    event.preventDefault()
    root.focus()
    return
  }
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  const active = document.activeElement
  if (event.shiftKey) {
    // el panel mismo (foco inicial) cuenta como "antes del primero"
    if (active === first || active === root) {
      event.preventDefault()
      last.focus()
    }
  } else if (active === last) {
    event.preventDefault()
    first.focus()
  }
}

function onKey(event: KeyboardEvent) {
  if (!isTopLayer(id)) return
  if (event.key === 'Escape') {
    emit('close')
    return
  }
  if (event.key === 'Tab') trapTab(event)
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  popLayer(id)
})

// suelo de foco: role=dialog aria-modal no basta si el foco se queda atrás,
// así que lo movemos al abrir y lo devolvemos a quien abrió el sheet al
// cerrar. immediate: true porque un sheet puede montarse ya abierto (v-if en
// el padre en vez de v-show) — sin esto, nunca entra en la pila de capas y
// Escape se lo come en silencio. La rama else es un no-op inofensivo en el
// disparo inicial con open=false.
watch(
  () => props.open,
  async (open) => {
    if (open) {
      pushLayer(id)
      lastFocused = document.activeElement as HTMLElement | null
      await nextTick()
      panel.value?.focus()
    } else {
      popLayer(id)
      lastFocused?.focus()
      lastFocused = null
    }
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="rg-sheet-backdrop">
      <!-- bg-scrim es su propio token, siempre oscuro en los dos temas (un
           scrim atenúa, nunca aclara — ver tokens/index.ts::scrim) -->
      <div
        v-if="open"
        class="fixed inset-0 z-(--rg-z-sheet) bg-scrim"
        @click="emit('close')"
      />
    </Transition>
    <Transition name="rg-sheet-panel">
      <div
        v-if="open"
        ref="panel"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-labelledby="title ? titleId : undefined"
        class="fixed inset-x-0 bottom-0 z-(--rg-z-sheet) rg-slab rounded-t-md border-b-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[85dvh] overflow-y-auto"
      >
        <div class="mx-auto mb-3 h-1 w-10 rounded-xs bg-line-strong" aria-hidden="true" />
        <h2 v-if="title" :id="titleId" class="font-display font-semibold uppercase tracking-wider text-sm mb-3">
          {{ title }}
        </h2>
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Excepción documentada al doctrine "solo entrada" del resto de la app
   (ver animations.css): el sheet (cajón inferior) también anima al cerrarse
   — un modal que desaparece de golpe rompe la sensación física de "cajón
   que se desliza" que sí tiene al abrir. Vive aquí, scoped, a propósito:
   animations.css es solo-entrada por diseño y su guard de reduced-motion es
   universal (*, *::before, *::after), así que sigue neutralizando estas
   animaciones sin tocar ese archivo ni duplicar el guard. */
@keyframes rg-sheet-backdrop-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes rg-sheet-panel-rise {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

.rg-sheet-backdrop-enter-active {
  animation: rg-sheet-backdrop-fade var(--rg-dur-3) var(--rg-ease-out);
}
/* leave: mismo keyframe en reversa (to → from) para no duplicar la
   definición, pero más corta y de arranque brusco, como corresponde a una
   salida en vez de una entrada */
.rg-sheet-backdrop-leave-active {
  animation: rg-sheet-backdrop-fade var(--rg-dur-2) ease-in reverse;
}

.rg-sheet-panel-enter-active {
  animation: rg-sheet-panel-rise var(--rg-dur-3) var(--rg-ease-out);
}
.rg-sheet-panel-leave-active {
  animation: rg-sheet-panel-rise var(--rg-dur-2) ease-in reverse;
}
</style>
