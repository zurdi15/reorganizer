<script setup lang="ts">
// Shell de la app con identidad PROPIA de Reorganizer (herramienta de
// fototeca / cuarto oscuro), deliberadamente DISTINTA del shell de berserk
// del que se portó. Se retiran sus firmas: la barra superior centrada con
// subrayado deslizante, el slab CTA elevado con glow ámbar, el indicador por
// 1/4 del móvil y el gesto de swipe entre secciones.
//
// En su lugar:
//   - desktop (≥sm): RAIL VERTICAL a la izquierda (patrón Lightroom/gestor de
//     medios) — marca arriba, filas ancho completo, la fila activa marcada
//     con filo ámbar + relleno bg-slab + texto ámbar (NO subrayado).
//   - móvil (<sm): barra inferior plana de 4 items iguales; el activo lleva
//     un lozenge ámbar detrás del icono (NO slab elevado, NO barra deslizante).
//   - subidas en curso: badge ámbar discreto en el item Subir (n/total en el
//     rail, punto en la barra inferior) — reemplaza al glow del slab.
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

import ActiveJobBand from '@/components/shell/ActiveJobBand.vue'
import RgIcon from '@/lib/RgIcon.vue'
import type { IconName } from '@/lib/icons'
import { useUploadsStore } from '@/stores/uploads'

// 4 secciones, TODAS iguales (Subir ya no es un CTA elevado): el rail de
// desktop y la barra inferior de móvil comparten este mismo array.
const items: { name: string; label: string; icon: IconName }[] = [
  { name: 'organize', label: 'shell.nav.organize', icon: 'folder-open' },
  { name: 'upload', label: 'shell.nav.upload', icon: 'upload' },
  { name: 'history', label: 'shell.nav.history', icon: 'history' },
  { name: 'settings', label: 'shell.nav.settings', icon: 'gear' },
]

const route = useRoute()
const uploads = useUploadsStore()
// locale vivo solo para el hint sutil del pie del rail (ES/EN)
const { locale } = useI18n()

// <main> es el ÚNICO scroller de la app y las vistas fluyen. El reset de
// scroll al cambiar de sección se hace aquí, explícito, sobre el PATH.
// Asignación directa a scrollTop (no scrollTo()): mismo efecto y happy-dom la
// soporta sin mock.
const mainEl = ref<HTMLElement | null>(null)
watch(() => route.path, () => {
  if (mainEl.value) mainEl.value.scrollTop = 0
})
</script>

<template>
  <div class="h-dvh flex">
    <!-- RAIL VERTICAL (desktop): dos columnas — rail fijo + columna de
         contenido. hidden en móvil; ahí manda la barra inferior. -->
    <aside class="hidden sm:flex sm:flex-col w-56 shrink-0 border-r border-line bg-stone">
      <!-- marca: apertura de cámara ámbar + wordmark en la tipografía display
           (identidad fototeca/cuarto oscuro, no chat/workout) -->
      <div class="flex items-center gap-2.5 px-4 h-14 border-b border-line">
        <svg
          class="text-amber shrink-0"
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" />
          <path d="M14.31 8L20.05 17.94" />
          <path d="M9.69 8L21.17 8" />
          <path d="M7.38 12L13.12 2.06" />
          <path d="M9.69 16L3.95 6.06" />
          <path d="M14.31 16L2.83 16" />
          <path d="M16.62 12L10.88 21.94" />
        </svg>
        <span class="font-display text-lg font-semibold tracking-tight text-ink">
          {{ $t('shell.appName') }}
        </span>
      </div>
      <!-- filas de navegación: fila ancho completo (icono + etiqueta), target
           generoso. active-state por comparación de route.name (RouterLink ya
           pone aria-current="page" en el enlace activo). -->
      <nav
        class="flex-1 flex flex-col gap-1 p-2"
        :aria-label="$t('shell.nav.label')"
        data-testid="rail-nav"
      >
        <RouterLink
          v-for="item in items"
          :key="item.name"
          :to="{ name: item.name }"
          class="relative flex items-center gap-3 rounded-sm pl-4 pr-3 py-2.5 text-sm transition-colors"
          :class="route.name === item.name
            ? 'bg-slab text-amber font-medium'
            : 'text-ink-muted hover:bg-slab hover:text-ink'"
        >
          <!-- filo ámbar de la fila activa: marca vertical en el borde, NO un
               subrayado deslizante (firma berserk retirada) -->
          <span
            v-if="route.name === item.name"
            class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-amber"
            aria-hidden="true"
          />
          <RgIcon :name="item.icon" :size="20" />
          <span>{{ $t(item.label) }}</span>
          <!-- badge de subidas en curso (reemplaza al slab CTA con glow):
               n/total del lote, visible desde cualquier sección -->
          <span
            v-if="item.name === 'upload' && uploads.active"
            class="ml-auto rg-metric text-2xs px-1.5 py-0.5 rounded-full bg-amber/15 text-amber"
            data-testid="upload-badge-rail"
          >{{ $t('shell.uploadsActive', { done: uploads.processed, total: uploads.total }) }}</span>
        </RouterLink>
      </nav>
      <!-- pie sutil del rail: hint de locale (ES/EN). No duplica la versión de
           la app (vive en Ajustes) — solo un indicador silencioso de estado. -->
      <div class="px-4 py-3 border-t border-line text-2xs uppercase tracking-wider text-ink-faint">
        {{ locale }}
      </div>
    </aside>

    <!-- columna de contenido: banda de job activo (arriba, visible en toda la
         app) + el único scroller <main>. min-w-0 para que el rail no se
         comprima cuando una vista trae contenido ancho. -->
    <div class="flex-1 min-w-0 flex flex-col">
      <!-- banda de job activo: al inicio de la columna de contenido; navega a
           /organize al tocarla (ver ActiveJobBand.vue) -->
      <ActiveJobBand />
      <!-- EL MODELO DE SCROLL (estable, heredado): <main> es el ÚNICO scroller
           de la app, a ancho completo (la columna centrada vive en el wrapper
           de abajo). Las vistas FLUYEN (altura por contenido) y su chrome se
           pega con sticky top-0 contra este scrollport. -->
      <main
        ref="mainEl"
        class="flex-1 min-h-0 overflow-y-auto rg-scroll-stable w-full"
      >
        <!-- wrapper de FLUJO puro — columna centrada, altura por contenido.
             pb-24 reserva el hueco de la barra inferior fija en móvil; en
             desktop (sin barra inferior) basta un respiro menor. -->
        <div class="max-w-3xl mx-auto w-full px-4 pt-4 pb-24 sm:pb-10">
          <RouterView />
        </div>
      </main>
    </div>

    <!-- BARRA INFERIOR (móvil): 4 items iguales, plana. Oculta en desktop. -->
    <nav
      class="fixed inset-x-0 bottom-0 z-(--rg-z-nav) border-t border-line bg-stone pb-[env(safe-area-inset-bottom)] sm:hidden"
      :aria-label="$t('shell.nav.label')"
      data-testid="bottom-nav"
    >
      <ul class="flex">
        <li v-for="item in items" :key="item.name" class="flex-1">
          <RouterLink
            :to="{ name: item.name }"
            class="flex flex-col items-center gap-1 pt-2 pb-1.5"
          >
            <!-- lozenge ámbar detrás del icono activo (reemplaza el slab
                 elevado y la barra deslizante): plano, sin glow. Todos los
                 items iguales, Subir incluido. -->
            <span
              class="relative flex h-8 w-12 items-center justify-center rounded-full transition-colors"
              :class="route.name === item.name ? 'bg-amber/15 text-amber' : 'text-ink-faint'"
              data-testid="bottom-nav-pill"
            >
              <RgIcon :name="item.icon" :size="20" />
              <!-- punto ámbar de subidas en curso: visible desde cualquier
                   sección (equivalente móvil del badge n/total del rail) -->
              <span
                v-if="item.name === 'upload' && uploads.active"
                class="absolute top-0.5 right-2.5 h-2 w-2 rounded-full bg-amber ring-2 ring-stone"
                data-testid="upload-badge-mobile"
                aria-hidden="true"
              />
            </span>
            <span
              class="text-2xs tracking-wide"
              :class="route.name === item.name ? 'text-amber' : 'text-ink-faint'"
            >{{ $t(item.label) }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>
  </div>
</template>
