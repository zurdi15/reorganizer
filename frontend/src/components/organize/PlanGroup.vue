<script setup lang="ts">
// Grupo colapsable de la preview del plan: subcarpeta destino + contador en
// cabecera; filas con mini-thumb, origen → destino relativo en mono. Todo
// nombre de archivo se renderiza como NODO DE TEXTO (anti-XSS, el pecado
// documentado del Reorganizer viejo). Colapsado por defecto (mobile-first).
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { inputThumbUrl } from '@/api/input'
import RgIcon from '@/lib/RgIcon.vue'
import type { IconName } from '@/lib/icons'
import type { JobItem } from '@/types/api'
import type { PlanGroup } from '@/utils/planGroups'

const props = defineProps<{ group: PlanGroup }>()
const { t } = useI18n()

const open = ref(false)

// thumbs rotas (o media_type desconocido) caen a icono, nunca al icono roto
// del navegador
const failedThumbs = ref(new Set<number>())
function markFailed(id: number) {
  failedThumbs.value = new Set(failedThumbs.value).add(id)
}

function showThumb(item: JobItem): boolean {
  return (
    (item.media_type === 'photo' || item.media_type === 'video') && !failedThumbs.value.has(item.id)
  )
}

function fallbackIcon(item: JobItem): IconName {
  if (item.media_type === 'video') return 'video'
  if (item.media_type === 'photo') return 'photo'
  return 'warning'
}

const label = computed(() => props.group.subfolder || t('organize.plan.rootGroup'))
</script>

<template>
  <div class="rounded-sm border border-line bg-void">
    <button
      type="button"
      class="flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left"
      :aria-expanded="open ? 'true' : 'false'"
      data-testid="plan-group-toggle"
      @click="open = !open"
    >
      <span class="flex min-w-0 items-center gap-2">
        <RgIcon name="folder" :size="16" class="shrink-0 text-ink-faint" />
        <span class="rg-metric truncate text-sm text-ink" data-testid="plan-group-name">{{ label }}</span>
      </span>
      <span class="flex shrink-0 items-center gap-2">
        <span class="rg-metric text-sm text-ink-muted" data-testid="plan-group-count">
          {{ t('organize.fileCount', group.rows.length) }}
        </span>
        <RgIcon
          name="chevron-down"
          :size="16"
          class="text-ink-faint transition-transform"
          :class="open && 'rotate-180'"
        />
      </span>
    </button>
    <ul v-if="open" class="border-t border-line" data-testid="plan-group-rows">
      <li
        v-for="row in group.rows"
        :key="row.item.id"
        class="flex items-center gap-2 px-3 py-1.5"
        data-testid="plan-row"
      >
        <img
          v-if="showThumb(row.item)"
          :src="inputThumbUrl(row.item.source_path)"
          alt=""
          loading="lazy"
          class="h-8 w-8 shrink-0 rounded-xs border border-line object-cover"
          @error="markFailed(row.item.id)"
        />
        <span v-else class="flex h-8 w-8 shrink-0 items-center justify-center text-ink-faint">
          <RgIcon :name="fallbackIcon(row.item)" :size="16" />
        </span>
        <span class="rg-metric min-w-0 flex-1 truncate text-xs text-ink">{{ row.item.source_path }}</span>
        <RgIcon name="arrow-right" :size="12" class="shrink-0 text-ink-faint" />
        <span class="rg-metric min-w-0 flex-1 truncate text-right text-xs text-ink-muted">{{ row.relDest }}</span>
      </li>
    </ul>
  </div>
</template>
