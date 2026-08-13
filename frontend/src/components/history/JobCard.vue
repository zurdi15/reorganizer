<script setup lang="ts">
// Tarjeta de un job del historial: cabecera compacta (pill de estado, modo,
// fecha relativa, dest en mono, contadores, chip Immich) que expande un
// acordeón inline con los items (NO una sheet: los listados pueden ser
// largos y merecen el scroll de la página). "Repetir con esta ruta" existe
// en TODO job sin importar su estado: los fallos se quedan en el input por
// diseño, así que re-ejecutar = organizar de nuevo (contrato con la vista
// Organizar: query param `dest`, nada más).
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import JobItemsList from './JobItemsList.vue'
import RgBadge from '@/lib/RgBadge.vue'
import RgButton from '@/lib/RgButton.vue'
import RgIcon from '@/lib/RgIcon.vue'
import type { IconName } from '@/lib/icons'
import type { JobRead, JobStatus } from '@/types/api'
import { formatRelativeDate, middleTruncate } from '@/utils/format'

const props = defineProps<{ job: JobRead }>()

const { t, te, locale } = useI18n()
const router = useRouter()

// acordeón perezoso: los items se piden en la PRIMERA expansión y el panel
// queda montado (v-show) para que replegar/expandir no re-descargue nada
const expanded = ref(false)
const everExpanded = ref(false)
function toggle() {
  expanded.value = !expanded.value
  if (expanded.value) everExpanded.value = true
}

interface PillSpec {
  variant: 'ok' | 'error' | 'neutral' | 'cobalt'
  key: string
  icon?: IconName
  iconClass?: string
}

// completed_with_errors va en neutral + icono warning en ámbar (terminó,
// pero pide mirar los errores); los estados vivos colapsan en la pill
// cobalto "en curso" — el detalle está en /organize
const STATUS_PILLS: Record<JobStatus, PillSpec> = {
  completed: { variant: 'ok', key: 'completed', icon: 'check' },
  completed_with_errors: {
    variant: 'neutral',
    key: 'completedWithErrors',
    icon: 'warning',
    iconClass: 'text-amber',
  },
  cancelled: { variant: 'neutral', key: 'cancelled' },
  interrupted: { variant: 'neutral', key: 'interrupted' },
  discarded: { variant: 'neutral', key: 'discarded' },
  failed: { variant: 'error', key: 'failed' },
  planning: { variant: 'cobalt', key: 'inProgress' },
  planned: { variant: 'cobalt', key: 'inProgress' },
  running: { variant: 'cobalt', key: 'inProgress' },
}

const pill = computed(() => STATUS_PILLS[props.job.status])

const IMMICH_CHIPS: Record<'ok' | 'failed' | 'skipped', { variant: 'ok' | 'error' | 'neutral'; icon?: IconName }> = {
  ok: { variant: 'ok', icon: 'check' },
  failed: { variant: 'error', icon: 'warning' },
  skipped: { variant: 'neutral' },
}
const immich = computed(() =>
  props.job.immich_status ? IMMICH_CHIPS[props.job.immich_status] : null,
)

const dateText = computed(() => formatRelativeDate(props.job.created_at, locale.value))
// la absoluta va en el title (tooltip/long-press): el relativo orienta, la
// absoluta desambigua
const dateTitle = computed(() => {
  const date = new Date(props.job.created_at)
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString(locale.value)
})

// truncado por el medio: el final de la ruta (el álbum) es lo distintivo
const destShort = computed(() => middleTruncate(props.job.dest_path, 44))

// slug fatal del job (jobs `failed` — no confundir con el CONTADOR
// `errors`): resuelto contra errors.* con fallback al slug crudo, mismo
// criterio que los errores por item
const fatalError = computed(() => props.job.error)
function slugText(slug: string): string {
  const key = `errors.${slug}`
  return te(key) ? t(key) : slug
}

// contrato de integración con la vista Organizar: SOLO empujar la ruta con
// el query param — Organizar siembra su path builder desde ahí
function repeat() {
  void router.push({ name: 'organize', query: { dest: props.job.dest_path } })
}
</script>

<template>
  <article class="rg-slab overflow-hidden" data-testid="job-card">
    <button
      type="button"
      class="rg-press block w-full min-h-10 p-4 text-left"
      :aria-expanded="expanded ? 'true' : 'false'"
      data-testid="job-card-toggle"
      @click="toggle"
    >
      <span class="flex items-center gap-2">
        <RgBadge :variant="pill.variant" data-testid="job-status-pill">
          <RgIcon v-if="pill.icon" :name="pill.icon" :size="12" :class="pill.iconClass" />
          {{ t(`history.status.${pill.key}`) }}
        </RgBadge>
        <RgBadge variant="neutral" data-testid="job-mode">
          {{ t(`history.mode.${job.transfer_mode}`) }}
        </RgBadge>
        <span class="ml-auto text-2xs text-ink-faint" :title="dateTitle" data-testid="job-date">
          {{ dateText }}
        </span>
        <RgIcon
          name="chevron-down"
          :size="16"
          class="shrink-0 text-ink-faint transition-transform"
          :class="expanded ? 'rotate-180' : ''"
        />
      </span>

      <!-- ruta en mono, truncada por el medio, completa en el title; SIEMPRE
           nodo de texto (anti-XSS) -->
      <span class="rg-metric mt-2 block text-sm text-ink" :title="job.dest_path" data-testid="job-dest">
        {{ destShort }}
      </span>

      <!-- contadores desde los campos planos del JobRead del backend
           (done/errors/skipped); los que están a cero no aportan y se
           ocultan. No hay contador de duplicados en JobRead: solo se ve en
           el detalle de items -->
      <span class="mt-2 flex flex-wrap items-center gap-1.5">
        <RgBadge variant="ok" data-testid="job-counter-done">
          {{ t('history.counters.done', job.done) }}
        </RgBadge>
        <RgBadge v-if="job.errors > 0" variant="error" data-testid="job-counter-errors">
          {{ t('history.counters.errors', job.errors) }}
        </RgBadge>
        <RgBadge v-if="job.skipped > 0" variant="neutral" data-testid="job-counter-skipped">
          {{ t('history.counters.skipped', job.skipped) }}
        </RgBadge>
        <RgBadge v-if="immich" :variant="immich.variant" data-testid="job-immich">
          <RgIcon v-if="immich.icon" :name="immich.icon" :size="12" />
          {{ t(`history.immich.${job.immich_status}`) }}
        </RgBadge>
      </span>
    </button>

    <div v-if="everExpanded" v-show="expanded" class="border-t border-line px-4 pb-4 pt-3">
      <p
        v-if="fatalError"
        class="mb-3 flex items-center gap-2 text-sm text-danger"
        data-testid="job-fatal-error"
      >
        <RgIcon name="warning" :size="16" class="shrink-0" />
        {{ slugText(fatalError) }}
      </p>

      <RgButton variant="ghost" block data-testid="job-repeat-btn" @click="repeat">
        {{ t('history.repeat') }}
        <RgIcon name="arrow-right" :size="16" />
      </RgButton>

      <JobItemsList :job-id="job.id" class="mt-3" />
    </div>
  </article>
</template>
