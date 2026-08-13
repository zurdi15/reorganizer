<script setup lang="ts">
// Vista de Ajustes (fase 13): tarjetas apiladas mobile-first. Las tres
// primeras dependen del server (settings + reglas, cargadas una vez vía
// ensureLoaded); Apariencia es local al dispositivo y se pinta siempre.
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import AppearanceCard from '@/components/settings/AppearanceCard.vue'
import GeneralCard from '@/components/settings/GeneralCard.vue'
import ImmichCard from '@/components/settings/ImmichCard.vue'
import RulesCard from '@/components/settings/RulesCard.vue'
import RgSpinner from '@/lib/RgSpinner.vue'
import { useSettingsStore } from '@/stores/settings'
import { toastApiError } from '@/utils/apiErrors'

const { t } = useI18n()
const store = useSettingsStore()

onMounted(() => {
  store.ensureLoaded().catch(toastApiError)
})
</script>

<template>
  <section class="flex flex-col gap-4">
    <h1 class="font-display text-lg font-semibold uppercase tracking-wider">
      {{ t('settings.title') }}
    </h1>

    <div v-if="!store.loaded" class="flex justify-center py-10">
      <RgSpinner size="lg" />
    </div>
    <template v-else>
      <RulesCard />
      <ImmichCard />
      <GeneralCard />
    </template>

    <AppearanceCard />
  </section>
</template>
