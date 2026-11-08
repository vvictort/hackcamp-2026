import { describe, expect, it } from 'vitest'
import { canOpen } from './RoleGate'

describe('canOpen', () => {
  it('refuses non-parent roles on /family without a fetch', () => {
    expect(canOpen('/family', 'teacher')).toBe(false)
    expect(canOpen('/family', 'ea')).toBe(false)
    expect(canOpen('/family', 'parent')).toBe(true)
  })
})
