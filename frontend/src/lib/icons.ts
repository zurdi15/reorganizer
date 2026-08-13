// Set de iconos propio de Reorganizer (sustituye a las runas de berserk):
// SVG inline de 24×24, stroke consistente (currentColor, width 2, caps y
// joins redondeados, fill none). Cada icono es una lista de `d` de <path> —
// nunca markup crudo (nada de v-html): RgIcon.vue los renderiza como nodos.
// Los círculos se expresan como pares de arcos para no necesitar <circle>.

export const icons = {
  // marco + sol + montaña
  photo: [
    'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
    'M8.5 10.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    'M21 15.5l-5-5L6.5 19',
  ],
  // cuerpo de cámara + lente saliente
  video: [
    'M3 7a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    'M15 10l6-3v10l-6-3',
  ],
  // cuadricóptero: cuerpo central, brazos en X y rotores
  drone: [
    'M10 10h4v4h-4z',
    'M10 10L7.4 7.4M14 10l2.6-2.6M10 14l-2.6 2.6M14 14l2.6 2.6',
    'M5.5 8a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
    'M18.5 8a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
    'M5.5 21a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
    'M18.5 21a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z',
  ],
  // flecha hacia arriba sobre bandeja
  upload: ['M12 16V4', 'M6 10l6-6 6 6', 'M4 20h16'],
  folder: [
    'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ],
  'folder-open': [
    'M3 17V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1',
    'M3 17l2.4-6.4A2 2 0 0 1 7.3 9.3H22l-2.7 7.4a2 2 0 0 1-1.9 1.3H3z',
  ],
  check: ['M5 13l4 4L19 7'],
  // triángulo + exclamación
  warning: ['M12 3.5L2.5 20h19z', 'M12 10v4', 'M12 17.2v.01'],
  clock: ['M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z', 'M12 7v5l3 3'],
  // engranaje simple: núcleo + 8 dientes
  gear: [
    'M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z',
    'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3',
    'M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1',
  ],
  // flecha circular hacia atrás + manecillas
  history: ['M4 5v4h4', 'M4.6 9A9 9 0 1 1 3 12', 'M12 8v4l3 2'],
  'chevron-down': ['M6 9l6 6 6-6'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  play: ['M8 5.5v13l10-6.5z'],
  'arrow-right': ['M4 12h16', 'M13 5l7 7-7 7'],
  // dos flechas circulares (recargar/reintentar)
  refresh: ['M20 5v4h-4', 'M19.4 9a8 8 0 1 0 .6 3'],
  // documento genérico: hoja con esquina doblada
  file: [
    'M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M14 3v4h4',
  ],
} as const

export type IconName = keyof typeof icons
