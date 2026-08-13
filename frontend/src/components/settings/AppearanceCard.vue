<script setup lang="ts">
// Apariencia: tema (oscuro/claro/sistema) e idioma (es/en). Preferencias
// LOCALES al dispositivo (localStorage vía utils/theme + i18n/applyLocale),
// sin backend — cada miembro de la casa ve la app a su gusto. Pie con la
// versión de la app, leída de package.json en build (sin hex ni magia).
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import pkg from '../../../package.json'
import { applyLocale } from '@/i18n'
import RgCard from '@/lib/RgCard.vue'
import RgSegmented from '@/lib/RgSegmented.vue'
import { setTheme } from '@/utils/theme'
import { getThemeMode, type ThemeMode } from '@/utils/uiPrefs'

const { t, locale } = useI18n()

const themeOptions = computed(() => [
  { value: 'dark', label: t('settings.appearance.dark') },
  { value: 'light', label: t('settings.appearance.light') },
  { value: 'system', label: t('settings.appearance.system') },
])
const languageOptions = [
  { value: 'es', label: 'ES' },
  { value: 'en', label: 'EN' },
]

// tema: estado local iniciado desde lo persistido; escribir aplica+persiste
const themeSelection = ref<string>(getThemeMode())
const themeModel = computed({
  get: () => themeSelection.value,
  set: (value: string) => {
    themeSelection.value = value
    setTheme(value as ThemeMode)
  },
})

// idioma: el locale vivo de vue-i18n ES el estado; applyLocale persiste
const languageModel = computed({
  get: () => locale.value,
  set: (value: string) => applyLocale(value),
})
</script>

<template>
  <RgCard :title="t('settings.appearance.title')">
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1.5">
        <span class="text-sm text-ink-muted">{{ t('settings.appearance.theme') }}</span>
        <RgSegmented
          v-model="themeModel"
          :options="themeOptions"
          :label="t('settings.appearance.theme')"
          data-testid="appearance-theme"
        />
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="text-sm text-ink-muted">{{ t('settings.appearance.language') }}</span>
        <RgSegmented
          v-model="languageModel"
          :options="languageOptions"
          :label="t('settings.appearance.language')"
          data-testid="appearance-language"
        />
      </div>
      <p class="rg-metric text-center text-xs text-ink-faint" data-testid="app-version">
        {{ t('settings.appearance.version', { version: pkg.version }) }}
      </p>
    </div>
  </RgCard>
</template>
