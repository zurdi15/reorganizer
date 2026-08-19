import { createRouter, createWebHistory } from 'vue-router'

import ShellView from '@/views/ShellView.vue'
import OrganizeView from '@/views/OrganizeView.vue'

// El shell y Organizar (la home) van en el chunk inicial: es lo que se pinta
// en el primer paint. Las otras tres se parten en chunks aparte — Ajustes
// sola pesa 27 KB (editor de reglas + Immich) que nadie necesita para ver la
// bandeja. Arranque: 294 → 252 KB (99,6 → 89,1 KB gzip).
const HistoryView = () => import('@/views/HistoryView.vue')
const SettingsView = () => import('@/views/SettingsView.vue')
const UploadView = () => import('@/views/UploadView.vue')

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
