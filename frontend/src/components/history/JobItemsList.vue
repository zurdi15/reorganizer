<script setup lang="ts">
// Lista de items de un job dentro del acordeón de JobCard: carga perezosa
// paginada (página 50, "Cargar más" mientras la última página venga llena) y
// agrupación errores-primero — lo accionable arriba, el listado largo debajo.
// Los source_path/dest son nombres del usuario: SIEMPRE nodos de texto o
// atributos vía binding (anti-XSS), jamás HTML.
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RgButton from '@/lib/RgButton.vue'
import RgIcon from '@/lib/RgIcon.vue'
import RgSpinner from '@/lib/RgSpinner.vue'
import type { IconName } from '@/lib/icons'
import { useJobsStore } from '@/stores/jobs'
import type { JobItem, JobItemStatus } from '@/types/api'
import { toastApiError } from '@/utils/apiErrors'
import { middleTruncate } from '@/utils/format'

const PAGE_SIZE = 50

const props = defineProps<{ jobId: number }>()

const { t, te } = useI18n()
const jobs = useJobsStore()

const items = ref<JobItem[]>([])
// arranca en true: la primera página SIEMPRE se pide al montar — así el
// primer render ya muestra el spinner sin esperar al tick de onMounted
const loading = ref(true)
const failed = ref(false)
const hasMore = ref(false)

// cada llamada pide la página siguiente a partir de lo ya cargado; una
// página incompleta significa que no hay más (el server no manda total)
async function loadPage() {
  loading.value = true
  failed.value = false
  try {
    const page = await jobs.loadJobItems(props.jobId, {
      limit: PAGE_SIZE,
      offset: items.value.length,
    })
    items.value.push(...page)
    hasMore.value = page.length === PAGE_SIZE
  } catch (error) {
    failed.value = true
    toastApiError(error)
  } finally {
    loading.value = false
  }
}

onMounted(loadPage)

// errores primero (slug + archivo, prominentes); el resto conserva el orden
// del server. Con paginación solo se agrupa lo YA cargado — orden estable
// dentro de cada grupo
const errorItems = computed(() => items.value.filter((item) => item.status === 'error'))
const restItems = computed(() => items.value.filter((item) => item.status !== 'error'))

// no hay iconos dedicados de skip/duplicado en el set: se reutilizan
// check/x/clock con color apagado + etiqueta de texto (el icono solo no
// bastaría para distinguirlos)
const STATUS_ICONS: Record<JobItemStatus, IconName> = {
  planned: 'clock',
  done: 'check',
  skipped: 'x',
  duplicate: 'check',
  error: 'warning',
  cancelled: 'x',
  missing: 'warning',
}

function destOf(item: JobItem): string | null {
  return item.final_dest ?? item.planned_dest
}

// slug de error → texto si existe en errors.*; si no, el slug crudo (mejor
// una pista críptica que "algo falló" sin más)
function slugText(slug: string): string {
  const key = `errors.${slug}`
  return te(key) ? t(key) : slug
}
</script>

<template>
  <div data-testid="job-items">
    <!-- primera carga: spinner centrado; las siguientes reusan el botón -->
    <div v-if="loading && items.length === 0" class="flex justify-center py-4">
      <RgSpinner data-testid="job-items-spinner" />
    </div>

    <template v-else-if="items.length === 0">
      <div v-if="failed" class="flex flex-col items-center gap-2 py-2">
        <p class="text-sm text-ink-muted">{{ t('history.items.loadFailed') }}</p>
        <RgButton variant="ghost" data-testid="job-items-retry" @click="loadPage">
          {{ t('common.retry') }}
        </RgButton>
      </div>
      <p v-else class="py-2 text-sm text-ink-muted" data-testid="job-items-empty">
        {{ t('history.items.empty') }}
      </p>
    </template>

    <template v-else>
      <section v-if="errorItems.length > 0" class="mb-2">
        <h3 class="mb-1 text-2xs font-display uppercase tracking-wide text-danger">
          {{ t('history.items.errorsHeading') }}
        </h3>
        <ul>
          <li
            v-for="item in errorItems"
            :key="item.id"
            class="flex items-start gap-2 py-1.5"
            data-testid="job-item-error"
          >
            <RgIcon name="warning" :size="16" class="mt-0.5 shrink-0 text-danger" />
            <div class="min-w-0">
              <p class="rg-metric text-sm text-ink" :title="item.source_path">
                {{ middleTruncate(item.source_path, 44) }}
              </p>
              <p class="text-2xs text-danger">{{ slugText(item.error ?? 'generic') }}</p>
            </div>
          </li>
        </ul>
      </section>

      <ul>
        <li
          v-for="item in restItems"
          :key="item.id"
          class="flex items-start gap-2 py-1.5"
          data-testid="job-item-row"
        >
          <RgIcon
            :name="STATUS_ICONS[item.status]"
            :size="16"
            class="mt-0.5 shrink-0"
            :class="item.status === 'done' ? 'text-ok' : 'text-ink-faint'"
          />
          <div class="min-w-0">
            <p class="rg-metric text-sm text-ink" :title="item.source_path">
              {{ middleTruncate(item.source_path, 44) }}
            </p>
            <p
              v-if="destOf(item)"
              class="rg-metric text-2xs text-ink-muted"
              :title="destOf(item) ?? undefined"
            >
              → {{ middleTruncate(destOf(item)!, 44) }}
            </p>
            <p v-if="item.status !== 'done'" class="text-2xs text-ink-faint">
              {{ t(`history.items.status.${item.status}`) }}
            </p>
          </div>
        </li>
      </ul>

      <RgButton
        v-if="hasMore"
        variant="ghost"
        block
        :loading="loading"
        class="mt-2"
        data-testid="job-items-load-more"
        @click="loadPage"
      >
        {{ t('history.items.loadMore') }}
      </RgButton>
    </template>
  </div>
</template>
