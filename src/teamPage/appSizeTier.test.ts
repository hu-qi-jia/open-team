// src/teamPage/appSizeTier.test.ts
import { describe, expect, it } from 'vitest'
import { APP_SIZE_COMPACT_MAX, APP_SIZE_MEDIUM_MAX, deriveAppSizeTier } from './appSizeTier'

describe('deriveAppSizeTier', () => {
  it('compact：宽度 ≤ 767', () => {
    expect(deriveAppSizeTier(0)).toBe('compact')
    expect(deriveAppSizeTier(500)).toBe('compact')
    expect(deriveAppSizeTier(APP_SIZE_COMPACT_MAX)).toBe('compact')
  })
  it('medium：768 ≤ 宽度 ≤ 1023', () => {
    expect(deriveAppSizeTier(768)).toBe('medium')
    expect(deriveAppSizeTier(900)).toBe('medium')
    expect(deriveAppSizeTier(APP_SIZE_MEDIUM_MAX)).toBe('medium')
  })
  it('wide：宽度 ≥ 1024', () => {
    expect(deriveAppSizeTier(1024)).toBe('wide')
    expect(deriveAppSizeTier(1420)).toBe('wide')
  })
})
