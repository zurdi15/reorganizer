<script setup lang="ts">
// Navegador del árbol de salida: la pieza que hace VISIBLE la estructura real
// mientras compones el destino. Muestra SIEMPRE (no tras el foco) la lista de
// subcarpetas del nivel confirmado (organize.destPath, vía GET /output/dirs),
// tappable para DESCENDER, con estado de carga (RgSpinner) y de vacío. Debajo,
// un campo "nueva carpeta" que filtra la lista en vivo (folded, en cliente) y
// —en Enter o cuando nada coincide— confirma un segmento nuevo: crear carpeta
// ES el caso de uso, el árbol nunca fuerza estructura existente. La validación
// de segmentos vive en utils/path (pura); el backend re-valida SIEMPRE. Los
// nombres se renderizan SIEMPRE como nodos de texto (anti-XSS, nunca v-html).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { fetchOutputDirs } from '@/api/output'
import RgField from '@/lib/RgField.vue'
import RgIcon from '@/lib/RgIcon.vue'
import RgSpinner from '@/lib/RgSpinner.vue'
import { useOrganizeStore } from '@/stores/organize'
import type { OutputDir } from '@/types/api'
import { isValidSegment, normalizeSegment } from '@/utils/path'
import { foldSearchText } from '@/utils/searchFold'

const { t } = useI18n()
const organize = useOrganizeStore()

// ---- carga de subdirectorios del nivel confirmado ----
// La lista depende SOLO de la ruta confirmada (el endpoint no filtra por
// prefijo): se recarga al cambiar de nivel con debounce de 300ms —una ráfaga
// de chips es UN fetch— y guard de carrera por token. Teclear NO recarga:
// filtra en cliente.
const DEBOUNCE_MS = 300

const dirs = ref<OutputDir[]>([])
const loading = ref(false)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let requestToken = 0

async function loadDirs() {
  const token = ++requestToken
  try {
    const result = await fetchOutputDirs(organize.destPath)
    if (token === requestToken) dirs.value = result
  } catch {
    // el árbol es azúcar navegable: sin red se sigue componiendo a mano
    if (token === requestToken) dirs.value = []
  } finally {
    // solo la respuesta más reciente apaga el spinner (las viejas se ignoran)
    if (token === requestToken) loading.value = false
  }
}

function scheduleLoadDirs() {
  // spinner desde ya: al descender, el nivel nuevo se anuncia "cargando" en el
  // acto aunque el fetch espere al debounce — el árbol lee como algo real
  loading.value = true
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

// ---- campo "nueva carpeta": filtra en vivo + confirma un segmento nuevo ----

const query = ref('')
const invalid = ref(false)

// teclear filtra la lista visible (folded a ambos lados: "cro" encuentra
// "Croàcia")
const matches = computed(() => {
  const q = foldSearchText(query.value.trim())
  if (!q) return dirs.value
  return dirs.value.filter((dir) => foldSearchText(dir.name).includes(q))
})

// lo tecleado, normalizado: lo que se confirmaría como segmento
const pendingName = computed(() => normalizeSegment(query.value))

// ¿el nombre tecleado NO existe ya en este nivel? → se pinta como "se creará"
// (crear es de primera clase; distinguible del descender a algo existente)
const isNewName = computed(() => {
  const q = foldSearchText(pendingName.value)
  if (!q) return false
  return !dirs.value.some((dir) => foldSearchText(dir.name) === q)
})

// ---- commit de segmentos (mismo contrato que el builder previo) ----

function commitQuery(): boolean {
  if (pendingName.value.length === 0) return false
  if (!organize.addSegment(query.value)) {
    invalid.value = true
    return false
  }
  query.value = ''
  invalid.value = false
  return true
}

// teclear '/' confirma lo escrito hasta ese punto (encadena segmentos); si
// algún tramo es inválido no se pierde lo tecleado — se marca el error
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

// backspace con el campo vacío = subir un nivel (patrón chip-input); keydown
// dispara ANTES de mutar el valor, así que query refleja el estado previo
function onBackspace() {
  if (query.value === '') organize.removeLastSegment()
}

// tap en una carpeta = DESCENDER: crece el breadcrumb y la lista recarga al
// nivel nuevo (el watch de destPath dispara scheduleLoadDirs)
function descend(name: string) {
  if (organize.addSegment(name)) {
    query.value = ''
    invalid.value = false
  }
}
</script>

<template>
  <!-- data-dest-path NO es cosmético: ata el render a la ruta confirmada. Al
       encadenar con '/' el último tramo puede dejar `query` en el MISMO valor
       (p. ej. 'nueva/' → ''), y sin esta dependencia el input no se re-sincro-
       nizaría con el modelo (Vue no repinta un valor sin cambio). Con ella,
       confirmar un segmento repinta y limpia el campo. No la quites. -->
  <div class="flex flex-col gap-2" :data-dest-path="organize.destPath">
    <!-- lista SIEMPRE visible de subcarpetas del nivel actual (no tras el
         foco): el árbol de salida se ve y se navega tocando -->
    <div class="rg-slab overflow-hidden" data-testid="dest-tree">
      <!-- carga -->
      <div
        v-if="loading"
        class="flex items-center justify-center gap-2 py-8 text-sm text-ink-muted"
        data-testid="dest-loading"
      >
        <RgSpinner size="sm" />
        <span>{{ t('organize.tree.loading') }}</span>
      </div>

      <!-- vacío: este nivel no tiene subcarpetas -->
      <p
        v-else-if="dirs.length === 0"
        class="flex items-center justify-center gap-2 py-8 text-center text-sm text-ink-faint"
        data-testid="dest-empty"
      >
        <RgIcon name="folder-open" :size="18" />
        <span>{{ t('organize.tree.empty') }}</span>
      </p>

      <!-- hay subcarpetas pero el filtro no casa ninguna -->
      <p
        v-else-if="matches.length === 0"
        class="flex items-center justify-center gap-2 py-8 text-center text-sm text-ink-faint"
        data-testid="dest-nomatches"
      >
        {{ t('organize.tree.noMatches') }}
      </p>

      <!-- carpetas del nivel: cada fila DESCIENDE al tocarla -->
      <Transition v-else name="rg-fade">
        <ul class="max-h-64 divide-y divide-line overflow-y-auto">
          <li v-for="dir in matches" :key="dir.name">
            <button
              type="button"
              class="rg-press flex min-h-10 w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-amber/10"
              :aria-label="t('organize.tree.open', { name: dir.name })"
              data-testid="dest-folder"
              @click="descend(dir.name)"
            >
              <RgIcon name="folder" :size="18" class="shrink-0 text-ink-muted" />
              <span class="rg-metric flex-1 truncate text-sm text-ink">{{ dir.name }}</span>
              <!-- has_children: hay más árbol debajo → afordancia de "entra" -->
              <RgIcon
                v-if="dir.has_children"
                name="arrow-right"
                :size="16"
                class="shrink-0 text-ink-faint"
                data-testid="dest-folder-more"
              />
            </button>
          </li>
        </ul>
      </Transition>
    </div>

    <!-- campo "nueva carpeta": filtra la lista de arriba y confirma un segmento
         nuevo (Enter o tap en la fila "se creará"). Nunca fuerza estructura. -->
    <div>
      <RgField
        :label="t('organize.tree.newFolder')"
        :model-value="query"
        mono
        :error="invalid ? t('organize.builder.invalidSegment') : undefined"
        :hint="isNewName ? undefined : t('organize.tree.newFolderHint')"
        data-testid="dest-input"
        @update:model-value="onQueryInput"
        @keydown.enter.prevent="commitQuery"
        @keydown.backspace="onBackspace"
      />
      <!-- lo tecleado no existe aún: fila "crear" en ámbar, visiblemente
           distinta de descender a algo existente -->
      <button
        v-if="isNewName"
        type="button"
        class="rg-press mt-1 flex min-h-10 w-full items-center gap-2.5 rounded-sm border border-amber bg-amber/10 px-3 py-2.5 text-left"
        data-testid="dest-create"
        @click="commitQuery"
      >
        <RgIcon name="folder" :size="18" class="shrink-0 text-amber" />
        <span class="rg-metric flex-1 truncate text-sm text-ink">{{ pendingName }}</span>
        <span class="rg-metric shrink-0 text-2xs uppercase tracking-wider text-amber">
          {{ t('organize.tree.willCreate') }}
        </span>
      </button>
    </div>
  </div>
</template>
