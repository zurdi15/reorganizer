<script setup lang="ts">
// Editor de una regla en bottom sheet (nunca modal centrado). Condiciones
// AND con control adaptativo por tipo, plantilla de destino con preview en
// vivo (utils/ruleTemplate — espejo cliente del motor), errores de slug
// inline en su campo, borrado con confirmación en dos pasos DENTRO de la
// sheet y un probador de casos contra POST /rules/test.
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { ApiError } from '@/api/client'
import { testRules, type RuleRead, type RuleSavePayload, type RuleTestResult } from '@/api/rules'
import RgButton from '@/lib/RgButton.vue'
import RgField from '@/lib/RgField.vue'
import RgSegmented from '@/lib/RgSegmented.vue'
import RgSheet from '@/lib/RgSheet.vue'
import { useSettingsStore } from '@/stores/settings'
import { useToastStore } from '@/stores/toast'
import { resolveApiErrorMessage, toastApiError } from '@/utils/apiErrors'
import { KNOWN_PLACEHOLDERS, previewRuleTemplate } from '@/utils/ruleTemplate'

const props = defineProps<{ open: boolean; rule: RuleRead | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const store = useSettingsStore()
const toast = useToastStore()

// ---- formulario ----
// los segmented emiten string plano (contrato de RgSegmented): las refs son
// string y el estrechado a los literales del payload ocurre al construirlo
const name = ref('')
const mediaType = ref<string>('any')
const orientation = ref<string>('any')
const filenameRegex = ref('')
const cameraMake = ref('')
const cameraModel = ref('')
const destTemplate = ref('')

const saving = ref(false)
const fieldErrors = ref<{ filename_regex?: string; dest_template?: string }>({})
const confirmingDelete = ref(false)
const deleting = ref(false)

// ---- probador ----
const testFilename = ref('')
const testMediaType = ref<string>('video')
const testOrientation = ref<string>('any')
const testing = ref(false)
const testResult = ref<RuleTestResult | null>(null)

// re-siembra del formulario al abrir (o al cambiar de regla): el estado
// efímero (errores, confirmación, probador) se resetea siempre
watch(
  () => [props.open, props.rule] as const,
  ([open, rule]) => {
    if (!open) return
    name.value = rule?.name ?? ''
    mediaType.value = rule?.media_type === 'photo' || rule?.media_type === 'video' ? rule.media_type : 'any'
    orientation.value = rule?.orientation ?? 'any'
    filenameRegex.value = rule?.filename_regex ?? ''
    cameraMake.value = rule?.camera_make ?? ''
    cameraModel.value = rule?.camera_model ?? ''
    destTemplate.value = rule?.dest_template ?? ''
    fieldErrors.value = {}
    confirmingDelete.value = false
    testResult.value = null
  },
  { immediate: true },
)

const anyOpt = computed(() => ({ value: 'any', label: t('settings.rule.any') }))
const mediaOptions = computed(() => [
  anyOpt.value,
  { value: 'photo', label: t('settings.rule.photo') },
  { value: 'video', label: t('settings.rule.video') },
])
const orientationOptions = computed(() => [
  anyOpt.value,
  { value: 'horizontal', label: t('settings.rule.horizontal') },
  { value: 'vertical', label: t('settings.rule.vertical') },
])

// preview en vivo del destino con valores de ejemplo (cliente puro)
const preview = computed(() => {
  const template = destTemplate.value.trim()
  return template ? previewRuleTemplate(template) : null
})

function insertPlaceholder(placeholder: string) {
  destTemplate.value += placeholder
}

// errores de slug con campo conocido → inline; el resto → toast
function applyError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.slug === 'invalid_regex') {
      fieldErrors.value = { filename_regex: resolveApiErrorMessage(error) }
      return
    }
    if (error.slug === 'invalid_dest_template' || error.slug === 'unknown_placeholder') {
      fieldErrors.value = { dest_template: resolveApiErrorMessage(error) }
      return
    }
  }
  toastApiError(error)
}

async function save() {
  if (saving.value) return
  fieldErrors.value = {}
  const dest = destTemplate.value.trim()
  if (!dest) {
    fieldErrors.value = { dest_template: t('settings.rule.destRequired') }
    return
  }
  // payload completo: una condición vaciada viaja como null EXPLÍCITO, que
  // en PATCH borra la condición (contrato backend); en POST equivale a "sin
  // condición" — misma forma para ambos verbos
  const payload: RuleSavePayload = {
    name: name.value.trim() || null,
    media_type: mediaType.value === 'any' ? null : (mediaType.value as 'photo' | 'video'),
    orientation:
      orientation.value === 'any' ? null : (orientation.value as 'horizontal' | 'vertical'),
    filename_regex: filenameRegex.value.trim() || null,
    camera_make: cameraMake.value.trim() || null,
    camera_model: cameraModel.value.trim() || null,
    dest_template: dest,
  }
  saving.value = true
  try {
    await store.saveRule(props.rule?.id ?? null, payload)
    toast.push('ok', t(props.rule ? 'settings.rule.updated' : 'settings.rule.created'))
    emit('close')
  } catch (error) {
    applyError(error)
  } finally {
    saving.value = false
  }
}

async function confirmDelete() {
  if (!props.rule || deleting.value) return
  deleting.value = true
  try {
    await store.removeRule(props.rule.id)
    toast.push('ok', t('settings.rule.deleted'))
    emit('close')
  } catch (error) {
    toastApiError(error)
  } finally {
    deleting.value = false
  }
}

async function runTest() {
  const filename = testFilename.value.trim()
  if (!filename || testing.value) return
  testing.value = true
  testResult.value = null
  try {
    testResult.value = await testRules({
      filename,
      media_type: testMediaType.value as 'photo' | 'video',
      ...(testOrientation.value !== 'any'
        ? { orientation: testOrientation.value as 'horizontal' | 'vertical' }
        : {}),
    })
  } catch (error) {
    toastApiError(error)
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <RgSheet
    :open="open"
    :title="t(rule ? 'settings.rule.titleEdit' : 'settings.rule.titleNew')"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <RgField v-model="name" :label="t('settings.rule.name')" data-testid="rule-name" />

      <!-- condiciones AND -->
      <fieldset class="flex flex-col gap-3">
        <legend class="mb-1 text-sm text-ink-muted">{{ t('settings.rule.conditions') }}</legend>
        <RgSegmented
          v-model="mediaType"
          :options="mediaOptions"
          :label="t('settings.rule.mediaType')"
          data-testid="rule-media-type"
        />
        <RgSegmented
          v-model="orientation"
          :options="orientationOptions"
          :label="t('settings.rule.orientation')"
          data-testid="rule-orientation"
        />
        <RgField
          v-model="filenameRegex"
          :label="t('settings.rule.filenameRegex')"
          mono
          hint="^dji"
          :error="fieldErrors.filename_regex"
          data-testid="rule-regex"
        />
        <RgField v-model="cameraMake" :label="t('settings.rule.cameraMake')" hint="DJI" data-testid="rule-make" />
        <RgField v-model="cameraModel" :label="t('settings.rule.cameraModel')" data-testid="rule-model" />
      </fieldset>

      <!-- destino + placeholders insertables + preview en vivo -->
      <div class="flex flex-col gap-2">
        <RgField
          v-model="destTemplate"
          :label="t('settings.rule.dest')"
          mono
          :error="fieldErrors.dest_template"
          data-testid="rule-dest"
        />
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs text-ink-faint">{{ t('settings.rule.placeholders') }}:</span>
          <button
            v-for="placeholder in KNOWN_PLACEHOLDERS"
            :key="placeholder"
            type="button"
            class="rg-metric rounded-sm border border-line bg-void min-h-10 px-2 text-xs text-ink-muted hover:border-line-strong hover:text-ink"
            @click="insertPlaceholder(placeholder)"
          >
            {{ placeholder }}
          </button>
        </div>
        <p v-if="preview" class="text-sm" data-testid="rule-preview">
          <template v-if="preview.ok">
            <span class="text-ink-faint">{{ t('settings.rule.preview') }}:</span>
            <span class="rg-metric break-all text-amber"> {{ preview.dest }}</span>
          </template>
          <span v-else class="text-danger">
            {{ t('settings.rule.previewUnknown', { name: preview.unknown }) }}
          </span>
        </p>
      </div>

      <RgButton block :loading="saving" data-testid="rule-save" @click="save">
        {{ t('settings.rule.save') }}
      </RgButton>

      <!-- probador de casos: un archivo sintético contra las reglas REALES -->
      <div class="flex flex-col gap-3 rounded-sm border border-line bg-void p-3">
        <h3 class="font-display text-xs font-semibold uppercase tracking-wider text-ink-muted">
          {{ t('settings.rule.testTitle') }}
        </h3>
        <RgField v-model="testFilename" :label="t('settings.rule.testFilename')" mono data-testid="rule-test-filename" />
        <RgSegmented
          v-model="testMediaType"
          :options="mediaOptions.slice(1)"
          :label="t('settings.rule.mediaType')"
        />
        <RgSegmented
          v-model="testOrientation"
          :options="orientationOptions"
          :label="t('settings.rule.orientation')"
        />
        <RgButton variant="ghost" block :loading="testing" data-testid="rule-test-run" @click="runTest">
          {{ t('settings.rule.testRun') }}
        </RgButton>
        <p v-if="testResult" class="text-sm" data-testid="rule-test-result">
          <template v-if="testResult.matched_rule_id !== null">
            <span class="text-ok">{{ testResult.matched_rule_name ?? `#${testResult.matched_rule_id}` }}</span>
            <span class="text-ink-faint"> → </span>
            <span class="rg-metric break-all text-ink">{{ testResult.dest }}</span>
          </template>
          <span v-else class="text-ink-muted">{{ t('settings.rule.testNoMatch') }}</span>
        </p>
      </div>

      <!-- borrado en dos pasos, solo al editar una regla existente -->
      <div v-if="rule" class="flex flex-col gap-2">
        <RgButton
          v-if="!confirmingDelete"
          variant="danger"
          block
          data-testid="rule-delete"
          @click="confirmingDelete = true"
        >
          {{ t('settings.rule.delete') }}
        </RgButton>
        <template v-else>
          <p class="text-center text-sm text-danger">{{ t('settings.rule.deleteWarning') }}</p>
          <RgButton
            variant="danger"
            block
            :loading="deleting"
            data-testid="rule-delete-confirm"
            @click="confirmDelete"
          >
            {{ t('settings.rule.deleteConfirm') }}
          </RgButton>
          <RgButton variant="ghost" block data-testid="rule-delete-cancel" @click="confirmingDelete = false">
            {{ t('common.cancel') }}
          </RgButton>
        </template>
      </div>
    </div>
  </RgSheet>
</template>
