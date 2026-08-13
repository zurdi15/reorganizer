<script setup lang="ts">
// Path builder por segmentos (la pieza central del flujo Organizar — nunca
// fuerza estructura): chips eliminables con lo confirmado + campo libre con
// autocompletado del árbol real de salida (GET /output/dirs). Un valor sin
// match se confirma igual — crear carpeta nueva ES el caso de uso. La
// validación de segmentos vive en utils/path (pura); el backend re-valida
// siempre. Los nombres se renderizan SIEMPRE como nodos de texto (anti-XSS).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { fetchOutputDirs } from '@/api/output'
import RgField from '@/lib/RgField.vue'
import RgIcon from '@/lib/RgIcon.vue'
import { useOrganizeStore } from '@/stores/organize'
import type { OutputDir } from '@/types/api'
import { isValidSegment, normalizeSegment } from '@/utils/path'
import { foldSearchText } from '@/utils/searchFold'

const { t } = useI18n()
const organize = useOrganizeStore()

const query = ref('')
const invalid = ref(false)
const focused = ref(false)

// ---- autocompletado: subdirectorios del nivel confirmado ----
// El listado depende SOLO de la ruta confirmada (el endpoint no filtra por
// prefijo): se recarga al cambiar de nivel con debounce de 300ms — una
// ráfaga de chips es UN fetch — y guard de carrera por token; teclear filtra
// la lista en cliente.
const DEBOUNCE_MS = 300

const dirs = ref<OutputDir[]>([])
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let requestToken = 0

async function loadDirs() {
  const token = ++requestToken
  try {
    const result = await fetchOutputDirs(organize.destPath)
    if (token === requestToken) dirs.value = result
  } catch {
    // el autocompletado es azúcar: sin red se sigue componiendo a mano
    if (token === requestToken) dirs.value = []
  }
}

function scheduleLoadDirs() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void loadDirs()
  }, DEBOUNCE_MS)
}

watch(() => organize.destPath, scheduleLoadDirs, { immediate: true })

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  // invalida cualquier respuesta en vuelo
  requestToken++
})

const matches = computed(() => {
  const q = foldSearchText(query.value.trim())
  if (!q) return dirs.value
  return dirs.value.filter((dir) => foldSearchText(dir.name).includes(q))
})

const panelVisible = computed(() => focused.value && matches.value.length > 0)

// ---- commit de segmentos ----

function commitQuery(): boolean {
  const raw = query.value
  if (normalizeSegment(raw).length === 0) return false
  if (!organize.addSegment(raw)) {
    invalid.value = true
    return false
  }
  query.value = ''
  invalid.value = false
  return true
}

// teclear '/' confirma lo escrito hasta ese punto (encadena segmentos); si
// algún tramo es inválido, no se pierde lo tecleado — se marca el error
function onQueryInput(value: string) {
  invalid.value = false
  if (!value.includes('/')) {
    query.value = value
    return
  }
  const parts = value.split('/')
  const rest = parts.pop() ?? ''
  const pending = parts.map(normalizeSegment).filter((part) => part.length > 0)
  if (!pending.every(isValidSegment)) {
    query.value = value
    invalid.value = true
    return
  }
  for (const part of pending) organize.addSegment(part)
  query.value = rest
}

function onEnter() {
  commitQuery()
}

// backspace con el campo vacío = quitar el último chip (patrón chip-input);
// keydown dispara ANTES de mutar el valor, así que query refleja el estado
// previo a la pulsación
function onBackspace() {
  if (query.value === '') organize.removeLastSegment()
}

// pointerdown.prevent en la opción: el input no pierde el foco (ni el panel
// se cierra) antes de que llegue el click
function commitSuggestion(name: string) {
  if (organize.addSegment(name)) {
    query.value = ''
    invalid.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- segmentos confirmados como chips mono eliminables + `..` (subir un
         nivel) — targets ≥40px -->
    <div class="flex flex-wrap items-center gap-1.5" data-testid="dest-chips">
      <button
        v-for="(segment, i) in organize.destSegments"
        :key="`${i}-${segment}`"
        type="button"
        class="rg-press rg-metric inline-flex min-h-10 items-center gap-1.5 rounded-sm border border-line bg-void px-2.5 text-sm text-ink hover:border-danger hover:text-danger"
        :aria-label="t('organize.builder.removeSegment', { segment })"
        data-testid="dest-chip"
        @click="organize.removeSegment(i)"
      >
        <span>{{ segment }}</span>
        <RgIcon name="x" :size="12" />
      </button>
      <button
        v-if="organize.destSegments.length > 0"
        type="button"
        class="rg-press rg-metric inline-flex min-h-10 items-center rounded-sm border border-line bg-void px-2.5 text-sm text-ink-muted hover:border-line-strong hover:text-ink"
        :aria-label="t('organize.builder.up')"
        data-testid="dest-up"
        @click="organize.removeLastSegment()"
      >
        ..
      </button>
    </div>

    <div>
      <RgField
        :label="t('organize.builder.fieldLabel')"
        :model-value="query"
        mono
        :error="invalid ? t('organize.builder.invalidSegment') : undefined"
        :hint="t('organize.builder.fieldHint')"
        data-testid="dest-input"
        @update:model-value="onQueryInput"
        @keydown.enter.prevent="onEnter"
        @keydown.backspace="onBackspace"
        @focusin="focused = true"
        @focusout="focused = false"
      />
      <!-- panel de autocompletado EN FLUJO (no overlay): en móvil, empujar el
           contenido es más honesto que tapar el teclado; '/' final marca que
           el directorio tiene hijos -->
      <ul
        v-if="panelVisible"
        class="mt-1 max-h-48 overflow-y-auto rounded-sm border border-line bg-void"
        data-testid="dest-panel"
      >
        <li v-for="dir in matches" :key="dir.name">
          <button
            type="button"
            class="rg-metric flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm text-ink hover:bg-amber/10"
            data-testid="dest-suggestion"
            @pointerdown.prevent
            @click="commitSuggestion(dir.name)"
          >
            <span class="truncate">{{ dir.name }}</span>
            <span v-if="dir.has_children" class="shrink-0 text-ink-faint">/</span>
          </button>
        </li>
      </ul>
    </div>

    <!-- preview de la ruta completa compuesta -->
    <p class="rg-metric break-all text-sm text-ink-muted" data-testid="dest-preview">
      → /output/{{ organize.destPath ? `${organize.destPath}/` : '' }}…
    </p>
  </div>
</template>
