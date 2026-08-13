import { createRouter, createWebHistory } from 'vue-router'

import ShellView from '@/views/ShellView.vue'
import HistoryView from '@/views/HistoryView.vue'
import OrganizeView from '@/views/OrganizeView.vue'
import SettingsView from '@/views/SettingsView.vue'
import UploadView from '@/views/UploadView.vue'

// Sin auth (LAN/VPN — decisión cerrada del plan): sin guards ni rutas
// públicas. /organize es la home: es donde se ve el estado del input.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: ShellView,
      redirect: { name: 'organize' },
      children: [
        { path: 'organize', name: 'organize', component: OrganizeView },
        { path: 'upload', name: 'upload', component: UploadView },
        { path: 'history', name: 'history', component: HistoryView },
        { path: 'settings', name: 'settings', component: SettingsView },
      ],
    },
    // cualquier ruta desconocida cae en organize en vez de una pantalla en blanco
    { path: '/:pathMatch(.*)*', redirect: { name: 'organize' } },
  ],
})
