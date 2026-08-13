<script setup lang="ts">
// Integración Immich: credenciales + test de conexión + selector de librería.
// La API key llega SIEMPRE enmascarada ("****" + últimos 4) del server: el
// campo muestra esa máscara y solo un valor genuinamente nuevo (o vacío, que
// la borra) la sobrescribe — reenviar la máscara es un no-op (contrato PUT).
// "Probar conexión" usa las credenciales del formulario como override; si va
// bien, las persiste (GET /immich/libraries no acepta override: solo puede
// listar con credenciales guardadas) y carga las librerías en el RgSelect.
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ImmichLibrary } from '@/api/settings'
import RgButton from '@/lib/RgButton.vue'
import RgCard from '@/lib/RgCard.vue'
import RgField from '@/lib/RgField.vue'
import RgSelect from '@/lib/RgSelect.vue'
import RgSwitch from '@/lib/RgSwitch.vue'
import { useSettingsStore } from '@/stores/settings'
import { useToastStore } from '@/stores/toast'
import { toastApiError } from '@/utils/apiErrors'

const { t } = useI18n()
const store = useSettingsStore()
const toast = useToastStore()

const enabled = ref(false)
const url = ref('')
const apiKey = ref('')
const libraryId = ref('')

const testing = ref(false)
const saving = ref(false)
const serverVersion = ref<string | null>(null)
const libraries = ref<ImmichLibrary[] | null>(null)

// siembra ÚNICA desde el store (un save de otra tarjeta también reemplaza
// settings — sin este guard, machacaría una edición a medias de este form)
let seeded = false
watch(
  () => store.settings,
  (settings) => {
    if (!settings || seeded) return
    seeded = true
    syncFrom(settings)
  },
  { immediate: true },
)

function syncFrom(settings: NonNullable<typeof store.settings>) {
  enabled.value = settings.immich_enabled
  url.value = settings.immich_url
  apiKey.value = settings.immich_api_key
  libraryId.value = settings.immich_library_id
}

// opciones del selector: las librerías reales si ya se cargaron; si no, el
// id guardado como única opción (para que el select no mienta en blanco)
function libraryOptions() {
  if (libraries.value) {
    return libraries.value.map((library) => ({ value: library.id, label: library.name }))
  }
  return libraryId.value ? [{ value: libraryId.value, label: libraryId.value }] : []
}

async function testConnection() {
  if (testing.value) return
  testing.value = true
  serverVersion.value = null
  try {
    const result = await store.immichTest({ url: url.value.trim(), api_key: apiKey.value })
    serverVersion.value = result.version
    // persistir credenciales verificadas ANTES de listar librerías (el
    // endpoint de librerías solo mira las guardadas en DB)
    await store.save({ immich_url: url.value.trim(), immich_api_key: apiKey.value })
    if (store.settings) syncFrom(store.settings)
    libraries.value = await store.immichLibraries()
    toast.push('ok', t('settings.immich.connected', { version: result.version }))
  } catch (error) {
    toastApiError(error)
  } finally {
    testing.value = false
  }
}

async function saveAll() {
  if (saving.value) return
  saving.value = true
  try {
    await store.save({
      immich_enabled: enabled.value,
      immich_url: url.value.trim(),
      immich_api_key: apiKey.value,
      immich_library_id: libraryId.value,
    })
    if (store.settings) syncFrom(store.settings)
    toast.push('ok', t('settings.immich.saved'))
  } catch (error) {
    toastApiError(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <RgCard :title="t('settings.immich.title')">
    <div class="flex flex-col gap-3">
      <RgSwitch v-model="enabled" :label="t('settings.immich.enabled')" data-testid="immich-enabled" />
      <RgField
        v-model="url"
        :label="t('settings.immich.url')"
        mono
        hint="https://immich.local"
        autocomplete="off"
        data-testid="immich-url"
      />
      <RgField
        v-model="apiKey"
        :label="t('settings.immich.apiKey')"
        type="password"
        autocomplete="off"
        data-testid="immich-api-key"
      />

      <div class="flex items-center gap-3">
        <RgButton
          variant="cobalt"
          :loading="testing"
          data-testid="immich-test"
          @click="testConnection"
        >
          {{ t('settings.immich.test') }}
        </RgButton>
        <span v-if="serverVersion" class="text-sm text-ok" data-testid="immich-version">
          {{ t('settings.immich.connected', { version: serverVersion }) }}
        </span>
      </div>

      <RgSelect
        v-model="libraryId"
        :label="t('settings.immich.library')"
        :options="libraryOptions()"
        data-testid="immich-library"
      />

      <RgButton block :loading="saving" data-testid="immich-save" @click="saveAll">
        {{ t('settings.immich.save') }}
      </RgButton>
    </div>
  </RgCard>
</template>
