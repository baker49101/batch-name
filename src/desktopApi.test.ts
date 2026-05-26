import { describe, expect, it } from 'vitest'

describe('desktopApi module', () => {
  it('can be imported in node without window', async () => {
    const apiModule = await import('./desktopApi')

    expect(apiModule.desktopApi).toBeUndefined()
    expect(apiModule.hasDesktopApi).toBe(false)
  })
})
