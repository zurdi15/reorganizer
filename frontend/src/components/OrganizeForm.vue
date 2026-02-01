<template>
  <form @submit.prevent="handleSubmit" class="space-y-4 card">
    <OutputPathInput ref="pathInputRef" />

    <button
      type="submit"
      :disabled="isProcessing || !pathStore.isValidPath"
      class="btn-primary w-full"
    >
      <span v-if="isProcessing" class="flex items-center justify-center gap-2">
        <div class="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        Processing...
      </span>
      <span v-else> Organize Files! </span>
    </button>
  </form>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePathStore } from '../stores/pathStore'
import { useProcessingStore } from '../stores/processingStore'
import { useWebSocket } from '../composables/useWebSocket'
import OutputPathInput from './OutputPathInput.vue'

const pathStore = usePathStore()
const processingStore = useProcessingStore()
const pathInputRef = ref<InstanceType<typeof OutputPathInput>>()
const ws = useWebSocket()

const isProcessing = computed(() => processingStore.isProcessing)

const handleSubmit = async (): Promise<void> => {
  if (!pathStore.isValidPath) {
    pathInputRef.value?.setAttempted()
    return
  }

  processingStore.startProcessing()

  try {
    if (!ws.isConnected.value) {
      await ws.connect()
    }

    ws.send({ path: pathStore.currentPath })
  } catch (error) {
    console.error('Error during organization:', error)
    processingStore.addError(`Error: ${error}`)
    processingStore.stopProcessing()
  }
}
</script>
