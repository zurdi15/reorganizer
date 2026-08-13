// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { formatBytes, formatRelativeDate, middleTruncate } from '../format'

describe('formatBytes', () => {
  it('formats sub-KB sizes as plain bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('uses base 1024 and one decimal only when it matters', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
    expect(formatBytes(12.3 * 1024 * 1024)).toBe('12.3 MB')
    expect(formatBytes(4.5 * 1024 * 1024 * 1024)).toBe('4.5 GB')
  })

  it('tops out at TB instead of inventing units', () => {
    expect(formatBytes(3 * 1024 ** 4)).toBe('3 TB')
    expect(formatBytes(5000 * 1024 ** 4)).toBe('5000 TB')
  })

  it('degrades to a dash for garbage input', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—')
  })
})

describe('middleTruncate', () => {
  it('returns short names untouched', () => {
    expect(middleTruncate('foto.jpg', 34)).toBe('foto.jpg')
    expect(middleTruncate('x'.repeat(34), 34)).toBe('x'.repeat(34))
  })

  it('truncates through the middle keeping the distinctive tail visible', () => {
    const out = middleTruncate('IMG_20240817_una_tarde_en_croacia (1).jpg', 20)
    expect(out).toHaveLength(20)
    expect(out).toContain('…')
    expect(out.startsWith('IMG_2024')).toBe(true)
    expect(out.endsWith('(1).jpg')).toBe(true)
  })

  it('never exceeds max, even for degenerate limits', () => {
    expect(middleTruncate('abcdef', 3)).toHaveLength(3)
    expect(middleTruncate('abcdef', 1)).toBe('…')
  })
})

describe('formatRelativeDate', () => {
  const now = new Date('2026-08-13T12:00:00Z')

  it('renders recent past in relative units (es)', () => {
    expect(formatRelativeDate('2026-08-13T11:59:30Z', 'es', now)).toContain('30')
    expect(formatRelativeDate('2026-08-13T11:57:00Z', 'es', now)).toBe('hace 3 minutos')
    expect(formatRelativeDate('2026-08-13T09:00:00Z', 'es', now)).toBe('hace 3 horas')
    expect(formatRelativeDate('2026-08-12T12:00:00Z', 'es', now)).toBe('ayer')
  })

  it('renders in the requested locale', () => {
    expect(formatRelativeDate('2026-08-12T12:00:00Z', 'en', now)).toBe('yesterday')
  })

  it('falls back to an absolute local date beyond a week (relative loses utility)', () => {
    const out = formatRelativeDate('2026-07-01T12:00:00Z', 'es', now)
    expect(out).toContain('2026')
    expect(out).not.toContain('hace')
  })

  it('degrades to a dash for invalid dates', () => {
    expect(formatRelativeDate('not-a-date', 'es', now)).toBe('—')
  })
})
