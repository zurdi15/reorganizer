<template>
  <div class="space-y-2">
    <h2 class="text-lg font-semibold text-white">Input Files</h2>
    <div class="card">
      <div v-if="isLoading" class="flex justify-center py-8">
        <div class="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-blue-600" />
      </div>
      <div v-else-if="error" class="rounded-lg bg-red-50 p-4 text-red-700">
        {{ error }}
      </div>
      <div v-else-if="files.length === 0" class="py-8 text-center text-gray-500">
        No files found in input folder
      </div>
      <ul v-else class="max-h-96 space-y-1 overflow-y-auto scrollbar-thin">
        <li
          v-for="file in files"
          :key="file.name"
          class="cursor-pointer rounded px-3 py-2 transition-colors hover:bg-amber-500/20"
          :class="[
            selectedFile?.name === file.name ? 'bg-amber-500/30 text-white' : 'text-gray-300',
            file.type === 'photo' ? 'border-l-4 border-blue-500' : file.type === 'video' ? 'border-l-4 border-purple-500' : 'border-l-4 border-gray-500',
          ]"
          @click="selectFile(file)"
        >
          <div class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2">
              <span class="text-lg">
                {{ file.type === 'photo' ? '🖼️' : file.type === 'video' ? '🎞️' : '📄' }}
              </span>
              <span class="truncate">{{ file.name }}</span>
            </div>
            <span class="ml-2 text-xs text-gray-400">{{ file.type }}</span>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useFileStore } from '../stores/fileStore'
// Preview disabled for now
// import { usePreviewStore } from '../stores/previewStore'
import type { File } from '../types/index'

const fileStore = useFileStore()
// const previewStore = usePreviewStore()

const files = computed(() => fileStore.files)
const selectedFile = computed(() => fileStore.selectedFile)
const isLoading = computed(() => fileStore.loading)
const error = computed(() => fileStore.error)

const selectFile = (file: File): void => {
  fileStore.selectFile(file)
}
</script>
