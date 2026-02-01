<template>
  <teleport to="body">
    <div
      v-if="isVisible"
      class="pointer-events-none fixed left-0 top-0 z-50 flex items-center justify-center"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
    >
      <div
        class="card pointer-events-auto max-h-96 max-w-md overflow-hidden rounded-lg shadow-2xl sm:max-h-64 sm:max-w-xs"
      >
        <!-- Loading spinner -->
        <div v-if="isLoading" class="flex h-32 items-center justify-center">
          <div class="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
        </div>

        <!-- Error message -->
        <div v-else-if="error" class="rounded-lg bg-red-50 p-4 text-red-700">
          {{ error }}
        </div>

        <!-- Image preview -->
        <img
          v-else-if="currentFile?.type === 'photo'"
          :src="currentFile?.previewUrl"
          :alt="currentFile?.name"
          class="h-full w-full object-cover"
          @load="onMediaLoad"
          @error="onMediaError"
        />

        <!-- Video preview -->
        <video
          v-else-if="currentFile?.type === 'video'"
          :src="currentFile?.previewUrl"
          autoplay
          muted
          loop
          class="h-full w-full object-cover"
          @loadeddata="onMediaLoad"
          @error="onMediaError"
        />
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { usePreviewStore } from '../stores/previewStore'

const previewStore = usePreviewStore()

const isVisible = computed(() => previewStore.isVisible)
const isLoading = computed(() => previewStore.isLoading)
const error = computed(() => previewStore.error)
const currentFile = computed(() => previewStore.currentFile)
const position = computed(() => previewStore.position)

const onMediaLoad = (): void => {
  previewStore.setLoading(false)
}

const onMediaError = (): void => {
  previewStore.setError('Failed to load media preview')
  previewStore.setLoading(false)
}
</script>
