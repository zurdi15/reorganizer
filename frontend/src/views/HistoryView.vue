<script setup lang="ts">
// Historial (fase 13): lista de JobCards del más reciente al más antiguo
// (orden que ya garantiza el server, id desc). Sin job seleccionado ni
// subrutas: cada tarjeta expande su propio acordeón. La banda de "trabajo en
// curso" es un atajo sutil a /organize, donde vive el progreso real.
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import JobCard from '@/components/history/JobCard.vue'
import RgButton from '@/lib/RgButton.vue'
import RgEmpty from '@/lib/RgEmpty.vue'
import RgIcon from '@/lib/RgIcon.vue'
import RgSpinner from '@/lib/RgSpinner.vue'
import { useJobsStore } from '@/stores/jobs'
import { toastApiError } from '@/utils/apiErrors'

const { t } = useI18n()
const router = useRouter()
const jobs = useJobsStore()

// el store no captura fallos de carga (contrato de oleada 3): aquí se
// convierten en toast + estado vacío con reintento, en vez de un throw mudo
const loadFailed = ref(false)

async function load() {
  loadFailed.value = false
  try {
    await jobs.loadHistory()
  } catch (error) {
    loadFailed.value = true
    toastApiError(error)
  }
}

onMounted(load)

// el CTA del vacío cambia de papel según el porqué del vacío: sin trabajos →
// a organizar; fallo de red → reintentar aquí mismo
function onEmptyAction() {
  if (loadFailed.value) void load()
  else void router.push({ name: 'organize' })
}
</script>

<template>
  <section>
    <header class="mb-4 flex items-center justify-between gap-2">
      <h1 class="font-display font-semibold uppercase tracking-wider text-lg">
        {{ t('history.title') }}
      </h1>
      <!-- no hay icono "refresh" dedicado en el set: history (flecha
           circular) comunica lo mismo aquí -->
      <RgButton
        variant="ghost"
        :loading="jobs.historyLoading"
        :aria-label="t('history.refresh')"
        data-testid="history-refresh"
        @click="load"
      >
        <RgIcon name="refresh" :size="16" />
        <span class="hidden sm:inline">{{ t('history.refresh') }}</span>
      </RgButton>
    </header>

    <RouterLink
      v-if="jobs.activeJob"
      :to="{ name: 'organize' }"
      class="rg-press mb-4 flex min-h-10 items-center gap-2 rounded-sm border border-cobalt/40 bg-cobalt/10 px-3 py-2 text-sm text-cobalt"
      data-testid="history-active-banner"
    >
      <RgIcon name="clock" :size="16" class="shrink-0" />
      <span>{{ t('history.activeBanner') }}</span>
      <RgIcon name="arrow-right" :size="16" class="ml-auto shrink-0" />
    </RouterLink>

    <div v-if="jobs.historyLoading && jobs.history.length === 0" class="flex justify-center py-10">
      <RgSpinner size="lg" />
    </div>

    <RgEmpty
      v-else-if="jobs.history.length === 0"
      icon="history"
      :message="loadFailed ? t('history.loadFailed') : t('history.empty')"
      :action-label="loadFailed ? t('common.retry') : t('history.emptyCta')"
      action-testid="history-empty-action"
      @action="onEmptyAction"
    />

    <ul v-else class="space-y-3">
      <li v-for="job in jobs.history" :key="job.id">
        <JobCard :job="job" />
      </li>
    </ul>
  </section>
</template>
