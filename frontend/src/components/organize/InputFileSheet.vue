<script setup lang="ts">
// Sheet de detalle de un archivo del input: preview grande + probe
// on-demand (EXIF/cámara/regla que matchearía HOY) + borrado con
// confirmación en dos pasos DENTRO de la sheet (nunca window.confirm).
// El probe se lanza al abrir, no antes: ffprobe/Pillow sobre demanda es
// caro y la grid no debe dispararlo en lote.
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { inputThumbUrl, probeInputFile } from '@/api/input'
import RgBadge from '@/lib/RgBadge.vue'
import RgButton from '@/lib/RgButton.vue'
import RgSheet from '@/lib/RgSheet.vue'
import RgSpinner from '@/lib/RgSpinner.vue'
import { useInputStore } from '@/stores/input'
import { useToastStore } from '@/stores/toast'
import type { InputFile, InputProbe } from '@/types/api'
import { resolveApiErrorMessage, toastApiError } from '@/utils/apiErrors'
import { formatBytes, formatRelativeDate } from '@/utils/format'

const props = defineProps<{ file: InputFile | null }>()
const emit = defineEmits<{ close: [] }>()

const { t, locale } = useI18n()
const input = useInputStore()
const toast = useToastStore()

const probe = ref<InputProbe | null>(null)
const probeLoading = ref(false)
const probeError = ref<string | null>(null)

const confirmingDelete = ref(false)
const deleting = ref(false)
const previewFailed = ref(false)

// probe-on-open + reset de todo el estado efímero al cambiar de archivo o
// cerrar. El guard de carrera: si el usuario cambia de archivo antes de que
// vuelva el probe anterior, la respuesta tardía se descarta.
watch(
  () => props.file,
  async (file) => {
    probe.value = null
    probeError.value = null
    confirmingDelete.value = false
    deleting.value = false
    previewFailed.value = false
    if (!file) return
    probeLoading.value = true
    try {
      const result = await probeInputFile(file.path)
      if (props.file?.path === file.path) probe.value = result
    } catch (error) {
      if (props.file?.path === file.path) probeError.value = resolveApiErrorMessage(error)
    } finally {
      if (props.file?.path === file.path) probeLoading.value = false
    }
  },
  { immediate: true },
)

const showPreview = computed(() => props.file !== null && props.file.kind !== 'unknown' && !previewFailed.value)

// pares etiqueta/valor del panel EXIF (mono): siempre las mismas filas, con
// '—' para lo que el probe no supo — una ficha estable lee mejor que filas
// que aparecen y desaparecen
const probeRows = computed(() => {
  const p = probe.value
  if (!p) return []
  return [
    { key: 'mediaType', value: t(`organize.kinds.${p.media_type}`) },
    { key: 'orientation', value: p.orientation ?? '—' },
    { key: 'takenAt', value: p.taken_at ? formatRelativeDate(p.taken_at, locale.value) : '—' },
    {
      key: 'camera',
      value: [p.camera_make, p.camera_model].filter(Boolean).join(' ') || '—',
    },
    {
      key: 'rule',
      // regla que matchearía hoy: nombre + destino de la regla; sin regla → el
      // fallback built-in _unknown/ (el aviso honesto, no un guion)
      value: p.matched_rule ? `${p.matched_rule.name} → ${p.matched_rule.dest}` : t('organize.sheet.noRule'),
    },
  ]
})

async function confirmDelete() {
  if (!props.file || deleting.value) return
  deleting.value = true
  try {
    await input.removeFile(props.file.path)
    toast.push('ok', t('organize.sheet.deleted'))
    emit('close')
  } catch (error) {
    toastApiError(error)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <RgSheet :open="file !== null" :title="t('organize.sheet.title')" @close="emit('close')">
    <div v-if="file" class="flex flex-col gap-4">
      <!-- nombre en mono, SIEMPRE como nodo de texto (anti-XSS) -->
      <p class="rg-metric break-all text-sm text-ink" data-testid="sheet-filename">{{ file.name }}</p>

      <!-- preview grande: también thumb=1 (JPEG 512px) — nunca originales -->
      <img
        v-if="showPreview"
        :src="inputThumbUrl(file.path)"
        :alt="file.name"
        loading="lazy"
        class="max-h-[45dvh] w-full rounded-sm border border-line bg-void object-contain"
        data-testid="sheet-preview"
        @error="previewFailed = true"
      />

      <div class="flex flex-wrap items-center gap-2">
        <RgBadge :variant="file.kind">{{ t(`organize.kinds.${file.kind}`) }}</RgBadge>
        <span class="rg-metric text-sm text-ink-muted">{{ formatBytes(file.size_bytes) }}</span>
        <!-- mtime es epoch en SEGUNDOS: a milisegundos antes de construir el Date -->
        <span class="rg-metric text-sm text-ink-muted">{{ formatRelativeDate(new Date(file.mtime * 1000), locale) }}</span>
      </div>

      <!-- ficha del probe: EXIF/cámara/regla en mono -->
      <div class="rounded-sm border border-line bg-void p-3" data-testid="sheet-probe">
        <div v-if="probeLoading" class="flex items-center gap-2 text-sm text-ink-muted">
          <RgSpinner size="sm" />
          <span>{{ t('organize.sheet.probing') }}</span>
        </div>
        <p v-else-if="probeError" class="text-sm text-danger">{{ probeError }}</p>
        <dl v-else-if="probe" class="flex flex-col gap-1.5">
          <div v-for="row in probeRows" :key="row.key" class="flex items-baseline justify-between gap-3">
            <dt class="shrink-0 text-xs text-ink-faint">{{ t(`organize.sheet.${row.key}`) }}</dt>
            <dd class="rg-metric break-all text-right text-sm text-ink">{{ row.value }}</dd>
          </div>
        </dl>
      </div>

      <!-- borrado en dos pasos, dentro de la sheet: el primer tap arma la
           confirmación, el segundo ejecuta; cancelar la desarma -->
      <div class="flex flex-col gap-2">
        <RgButton
          v-if="!confirmingDelete"
          variant="danger"
          block
          data-testid="sheet-delete"
          @click="confirmingDelete = true"
        >
          {{ t('organize.sheet.delete') }}
        </RgButton>
        <template v-else>
          <p class="text-center text-sm text-danger">{{ t('organize.sheet.deleteWarning') }}</p>
          <RgButton
            variant="danger"
            block
            :loading="deleting"
            data-testid="sheet-delete-confirm"
            @click="confirmDelete"
          >
            {{ t('organize.sheet.deleteConfirm') }}
          </RgButton>
          <RgButton variant="ghost" block data-testid="sheet-delete-cancel" @click="confirmingDelete = false">
            {{ t('common.cancel') }}
          </RgButton>
        </template>
      </div>
    </div>
  </RgSheet>
</template>
