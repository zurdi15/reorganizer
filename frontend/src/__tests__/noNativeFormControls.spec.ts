// @vitest-environment node

// En Android, <select>/<input type="date|time|..."> abren el picker nativo
// del SO — fuera de la estética del sistema de diseño. Este test recorre
// TODO src/ y falla si algún consumidor reintroduce uno de estos controles
// en vez de usar RgSelect. (Herencia berserk; aquí la única exención es
// RgSelect.vue — no hay primitivas de fecha/hora porque Reorganizer no pide
// fechas a mano: las saca del EXIF.)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC_DIR = fileURLToPath(new URL('..', import.meta.url))

// la propia primitiva está exenta: es el reemplazo sancionado
const EXEMPT = ['/lib/RgSelect.vue']

function isExempt(path: string): boolean {
  return EXEMPT.some((suffix) => path.endsWith(suffix))
}

function walkVueFiles(dir: string): string[] {
  let files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`
    const stats = statSync(full)
    if (stats.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      files = files.concat(walkVueFiles(full))
    } else if (full.endsWith('.vue')) {
      files.push(full)
    }
  }
  return files
}

// [\s/>] cubre también un <select /> autocerrado
const SELECT_RE = /<select[\s/>]/

// ["']* (cero o más comillas) cubre tanto el atributo estático (type="date")
// como uno vinculado con un literal de cadena dentro (:type="'date'"). \b al
// final para no confundir "date" con un prefijo de otra palabra. Todos los
// tipos nativos que abren un picker del SO en algún navegador.
const NATIVE_TYPE_RE = /type\s*=\s*["']*(date|time|datetime-local|month|week|color)\b/

describe('no native OS form pickers left in src/', () => {
  const files = walkVueFiles(SRC_DIR).filter((f) => !isExempt(f))

  it('no literal <select> element anywhere outside RgSelect.vue itself', () => {
    const offenders = files.filter((f) => SELECT_RE.test(readFileSync(f, 'utf-8')))
    expect(offenders).toEqual([])
  })

  it('no native-picker input type (date/time/datetime-local/month/week/color), static or bound, outside the primitive itself', () => {
    const offenders = files.filter((f) => NATIVE_TYPE_RE.test(readFileSync(f, 'utf-8')))
    expect(offenders).toEqual([])
  })

  it('sanity: the regexes actually match what they are meant to catch (guards against a silently-broken pattern)', () => {
    expect(SELECT_RE.test('<select>')).toBe(true)
    expect(SELECT_RE.test('<select />')).toBe(true)
    expect(SELECT_RE.test('<select-thing>')).toBe(false)

    expect(NATIVE_TYPE_RE.test('<input type="date" />')).toBe(true)
    expect(NATIVE_TYPE_RE.test("<input type='date' />")).toBe(true)
    expect(NATIVE_TYPE_RE.test(':type="\'date\'"')).toBe(true)
    expect(NATIVE_TYPE_RE.test('<input type="datetime-local" />')).toBe(true)
    expect(NATIVE_TYPE_RE.test('<input type="text" />')).toBe(false)
  })
})
