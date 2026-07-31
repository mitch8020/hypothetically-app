import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('browser entrypoint', () => {
  it('mounts the app into the root element', async () => {
    const render = vi.fn()
    const createRoot = vi.fn(() => ({ render }))
    vi.doMock('react-dom/client', () => ({ createRoot }))
    vi.doMock('./App', () => ({ default: () => null }))
    document.body.innerHTML = '<div id="root"></div>'

    await import('./main')

    expect(createRoot).toHaveBeenCalledWith(document.getElementById('root'))
    expect(render).toHaveBeenCalledOnce()
  })
})
