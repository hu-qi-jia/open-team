// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

describe('team page dom refs', () => {
  it('collects required team page elements and fails clearly when a selector is missing', async () => {
    document.body.innerHTML = `
      <main id="app"><div id="iframe-host"></div></main>
      <button id="close-window"></button>
      <button id="toggle-window-size"></button>
      <button id="toggle-fullscreen"></button>
      <div id="error"></div>
      <button id="theme-light"></button>
      <button id="theme-dark"></button>
      <button id="window-launcher"></button>
      <button id="window-resize-handle"></button>
    `

    const { createTeamPageDomRefs, requireElement } = await import('./domRefs')
    const refs = createTeamPageDomRefs()

    expect(refs.appShellEl.id).toBe('app')
    expect(refs.closeWindowEl.id).toBe('close-window')
    expect(refs.toggleFullscreenEl.id).toBe('toggle-fullscreen')
    expect(refs.themeLightEl.id).toBe('theme-light')
    expect(refs.themeDarkEl.id).toBe('theme-dark')
    expect(refs.windowResizeHandleEl.id).toBe('window-resize-handle')
    expect(refs.iframeHostEl.id).toBe('iframe-host')
    expect(() => requireElement('#missing')).toThrow('Missing element: #missing')
  })
})
