import { describe, expect, it } from 'vitest'
import { formatCompactNumber } from './format'

describe('formatCompactNumber', () => {
  it('keeps everyday values readable', () => {
    expect(formatCompactNumber(43.3333333333)).toBe('43')
    expect(formatCompactNumber(999)).toBe('999')
  })

  it('shortens large values with lowercase suffixes', () => {
    expect(formatCompactNumber(95_000)).toBe('95k')
    expect(formatCompactNumber(1_500_000)).toBe('1.5m')
    expect(formatCompactNumber(2_500_000_000)).toBe('2.5b')
  })
})
