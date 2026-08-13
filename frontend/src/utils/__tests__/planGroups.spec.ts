import { describe, expect, it } from 'vitest'

import type { JobItem } from '@/types/api'
import { groupPlanItems, isUnknownDest, relativeDest } from '../planGroups'

const DEST = '2024/08/croacia'

function makeItem(over: Partial<JobItem> = {}): JobItem {
  return {
    id: 1,
    job_id: 7,
    source_path: 'IMG_1.jpg',
    size_bytes: 1024,
    media_type: 'photo',
    orientation: null,
    taken_at: null,
    camera_make: null,
    camera_model: null,
    matched_rule_id: 1,
    planned_dest: `${DEST}/photo/IMG_1.jpg`,
    final_dest: null,
    status: 'planned',
    error: null,
    content_hash: null,
    collision: false,
    ...over,
  }
}

describe('utils/planGroups', () => {
  it('relativeDest strips the job dest_path prefix (and only the prefix)', () => {
    expect(relativeDest(makeItem(), DEST)).toBe('photo/IMG_1.jpg')
    // prefijo que no cuadra: se devuelve tal cual antes que inventar rutas
    expect(relativeDest(makeItem({ planned_dest: 'otra/ruta/x.jpg' }), DEST)).toBe('otra/ruta/x.jpg')
  })

  it('isUnknownDest detects the _unknown/ fallback under the dest', () => {
    expect(isUnknownDest(makeItem({ planned_dest: `${DEST}/_unknown/notas.txt` }), DEST)).toBe(true)
    expect(isUnknownDest(makeItem(), DEST)).toBe(false)
    // _unknown como SUBSTRING de otra carpeta no cuenta
    expect(isUnknownDest(makeItem({ planned_dest: `${DEST}/_unknown_x/a.jpg` }), DEST)).toBe(false)
  })

  it('groups by the subfolder between dest_path and filename, root first, alphabetical', () => {
    const items = [
      makeItem({ id: 1, planned_dest: `${DEST}/video/horizontal/DJI_1.MP4` }),
      makeItem({ id: 2, planned_dest: `${DEST}/photo/IMG_2.jpg` }),
      makeItem({ id: 3, planned_dest: `${DEST}/photo/IMG_1.jpg` }),
      makeItem({ id: 4, planned_dest: `${DEST}/suelto.jpg` }),
    ]
    const groups = groupPlanItems(items, DEST)
    expect(groups.map((g) => g.subfolder)).toEqual(['', 'photo', 'video/horizontal'])
    // dentro del grupo se conserva el orden del plan
    expect(groups[1].rows.map((r) => r.filename)).toEqual(['IMG_2.jpg', 'IMG_1.jpg'])
    expect(groups[0].rows[0].relDest).toBe('suelto.jpg')
  })
})
