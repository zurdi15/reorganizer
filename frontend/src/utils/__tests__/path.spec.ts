// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { isValidRelPath, isValidSegment, joinSegments, normalizeSegment } from '../path'

describe('normalizeSegment', () => {
  it('trims whitespace and leading/trailing dots and spaces', () => {
    expect(normalizeSegment('  croacia  ')).toBe('croacia')
    expect(normalizeSegment('croacia...')).toBe('croacia')
    expect(normalizeSegment('...croacia')).toBe('croacia')
    expect(normalizeSegment(' . croacia . ')).toBe('croacia')
  })

  it('keeps interior dots and spaces (they are legitimate in album names)', () => {
    expect(normalizeSegment('st. john trip')).toBe('st. john trip')
  })

  it('collapses dot-only or whitespace-only input to empty', () => {
    expect(normalizeSegment('...')).toBe('')
    expect(normalizeSegment('   ')).toBe('')
    expect(normalizeSegment('. .')).toBe('')
  })
})

describe('isValidSegment', () => {
  it('accepts normal folder names', () => {
    expect(isValidSegment('2024')).toBe(true)
    expect(isValidSegment('08')).toBe(true)
    expect(isValidSegment('croacia')).toBe(true)
    expect(isValidSegment('año nuevo')).toBe(true)
  })

  it('rejects empty and dot navigation', () => {
    expect(isValidSegment('')).toBe(false)
    expect(isValidSegment('.')).toBe(false)
    expect(isValidSegment('..')).toBe(false)
  })

  it('rejects path separators (both directions)', () => {
    expect(isValidSegment('a/b')).toBe(false)
    expect(isValidSegment('a\\b')).toBe(false)
  })

  it('rejects Windows-reserved and control characters', () => {
    for (const bad of ['a<b', 'a>b', 'a:b', 'a"b', 'a|b', 'a?b', 'a*b', 'a\u0000b', 'a\tb', 'a\u007Fb']) {
      expect(isValidSegment(bad), JSON.stringify(bad)).toBe(false)
    }
  })

  it('rejects absurdly long segments', () => {
    expect(isValidSegment('x'.repeat(121))).toBe(false)
    expect(isValidSegment('x'.repeat(120))).toBe(true)
  })
})

describe('isValidRelPath', () => {
  it('accepts the canonical flexible destinations of the plan', () => {
    expect(isValidRelPath('2024/08/croacia')).toBe(true)
    expect(isValidRelPath('2024/aniversario')).toBe(true)
    expect(isValidRelPath('2024/08/croacia/istria')).toBe(true)
  })

  it('rejects absolute paths and trailing slashes', () => {
    expect(isValidRelPath('/2024/08')).toBe(false)
    expect(isValidRelPath('2024/08/')).toBe(false)
    expect(isValidRelPath('/')).toBe(false)
  })

  it('rejects traversal and empty segments', () => {
    expect(isValidRelPath('../etc')).toBe(false)
    expect(isValidRelPath('2024/../etc')).toBe(false)
    expect(isValidRelPath('2024//08')).toBe(false)
    expect(isValidRelPath('')).toBe(false)
  })

  it('rejects segments that are not normalized (trailing dots/spaces must be fixed by the builder, never silently accepted)', () => {
    expect(isValidRelPath('2024/croacia ')).toBe(false)
    expect(isValidRelPath('2024/croacia...')).toBe(false)
    expect(isValidRelPath(' 2024/croacia')).toBe(false)
  })
})

describe('joinSegments', () => {
  it('joins confirmed segments with / and drops invalid leftovers defensively', () => {
    expect(joinSegments(['2024', '08', 'croacia'])).toBe('2024/08/croacia')
    expect(joinSegments(['2024', '..', 'croacia'])).toBe('2024/croacia')
    expect(joinSegments([])).toBe('')
  })
})
