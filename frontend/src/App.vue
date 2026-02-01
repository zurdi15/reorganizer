<template>
  <div class="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
    <!-- Header -->
    <header class="border-b border-gray-700 bg-gray-800/90 backdrop-blur-sm shadow-lg">
      <div class="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
        <div class="flex items-center gap-3">
          <img src="/logo.svg" alt="Reorganizer Logo" class="h-10 w-10" />
          <h1 class="text-2xl font-bold text-white">Reorganizer</h1>
        </div>
      </div>
    </header>

    <!-- Main content -->
    <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div class="grid gap-8 lg:grid-cols-2">
        <!-- Left column: Input and controls -->
        <div class="space-y-6">
          <section>
            <FileList />
          </section>

          <section>
            <OrganizeForm />
          </section>
        </div>

        <!-- Right column: Stats and logs -->
        <div class="space-y-6">
          <section>
            <ProcessingStats />
          </section>

          <section>
            <LogViewer />
          </section>
        </div>
      </div>
    </main>

    <!-- Preview component -->
    <FilePreview />
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import { useFileStore } from './stores/fileStore'
import { useWebSocket } from './composables/useWebSocket'
import FileList from './components/FileList.vue'
import OrganizeForm from './components/OrganizeForm.vue'
import ProcessingStats from './components/ProcessingStats.vue'
import LogViewer from './components/LogViewer.vue'
import FilePreview from './components/FilePreview.vue'

const fileStore = useFileStore()
const ws = useWebSocket()

onMounted(async () => {
  // Fetch initial file list
  await fileStore.fetchInputFiles()

  // Connect to WebSocket
  try {
    await ws.connect()
  } catch (error) {
    console.error('Failed to connect WebSocket:', error)
  }
})

onBeforeUnmount(() => {
  ws.disconnect()
})
</script>
