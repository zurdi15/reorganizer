// Setup global de vitest — higiene de localStorage (lección berserk, el
// porqué de su ci rojo crónico): uiPrefs persiste en localStorage y los
// specs montan pinias frescas SIN limpiar el storage. Nadie lo notaba
// porque el resultado dependía de la versión de Node:
//   - Node ≥23: expone un localStorage global ROTO sin --localstorage-file
//     (setItem is not a function) que hace sombra al de happy-dom → la
//     persistencia muere en el try/catch de producción y los tests salen
//     verdes POR ACCIDENTE.
//   - Node 22 (CI): sin global propio, manda el localStorage REAL de
//     happy-dom (compartido entre tests del mismo fichero) → lo persistido
//     en un test se filtra al siguiente.
// Aquí igualamos los dos mundos: storage FUNCIONAL siempre (si el de Node
// está roto, uno en memoria) y limpio antes de cada test. Y desmontaje
// automático de wrappers de VTU tras cada test: los wrappers que sobreviven
// siguen REACTIVOS (watchers vivos) y pueden tocar DOM ya arrancado por
// otros tests.
import { afterEach, beforeEach } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

enableAutoUnmount(afterEach)

function storageWorks(): boolean {
  try {
    localStorage.setItem('__rg_probe__', '1')
    localStorage.removeItem('__rg_probe__')
    return true
  } catch {
    return false
  }
}

if (!storageWorks()) {
  const backing = new Map<string, string>()
  const memoryStorage: Storage = {
    get length() {
      return backing.size
    },
    clear: () => backing.clear(),
    getItem: (key) => (backing.has(key) ? backing.get(key)! : null),
    key: (index) => [...backing.keys()][index] ?? null,
    removeItem: (key) => {
      backing.delete(key)
    },
    setItem: (key, value) => {
      backing.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
  })
}

beforeEach(() => {
  localStorage.clear()
})
