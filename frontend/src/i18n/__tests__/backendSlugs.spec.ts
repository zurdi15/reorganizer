// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { es } from '../es'

// Barrido de slugs del backend (oleada 5): cada error que el backend puede
// emitir — detail="..." en HTTPException, excepciones de dominio con slug,
// y asignaciones item.error/job.error del motor de jobs — debe tener su
// entrada errors.* traducida. Sin esto, un slug nuevo llega a pantalla en
// crudo y nadie lo nota hasta producción.
const BACKEND_APP = resolve(__dirname, '../../../../backend/app')

function pyFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__pycache__' ? [] : pyFiles(full)
    return name.endsWith('.py') ? [full] : []
  })
}

function backendSlugs(): Set<string> {
  const slugs = new Set<string>()
  const patterns = [
    /detail="([a-z_]+)"/g, // HTTPException(detail="slug")
    /(?:ImmichError|JobConflictError|SettingsValidationError|PlanError)\(\s*"([a-z_]+)"/g,
    /\.error = "([a-z_]+)"/g, // item.error / job.error del motor de jobs
    /_fail\([^)]*"([a-z_]+)"\)/g, // _fail(session, job, broadcaster, "slug") del planner
  ]
  for (const file of pyFiles(BACKEND_APP)) {
    const source = readFileSync(file, 'utf8')
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) slugs.add(match[1])
    }
  }
  return slugs
}

describe('backend error slugs', () => {
  it('every backend slug has an errors.* translation', () => {
    const found = backendSlugs()
    // suelo de cordura: si el regex deja de matchear (refactor del backend),
    // este test debe fallar en vez de pasar en vacío
    expect(found.size).toBeGreaterThan(20)
    const known = new Set(Object.keys(es.errors))
    const missing = [...found].filter((slug) => !known.has(slug))
    expect(missing, `slugs sin traducir: ${missing.join(', ')}`).toEqual([])
  })
})
