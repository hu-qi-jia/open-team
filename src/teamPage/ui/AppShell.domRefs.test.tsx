// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { App } from './App'
import { renderWithServices } from './test/TestProviders'
import { createTeamPageDomRefs } from '../domRefs'

/*
 * 绞杀者模式的核心契约回归网：React AppShell 渲染出的 DOM 必须让
 * createTeamPageDomRefs() 取到它要的全部 id（壳层组件的保留 id）。
 * 任何一侧漂移（删掉了壳层组件里的 id）都会在这里立刻爆掉，而不是
 * 运行时白屏。
 */
describe('App shell', () => {
  it('renders every element createTeamPageDomRefs requires', () => {
    const { unmount } = renderWithServices(<App />, {})
    try {
      expect(() => createTeamPageDomRefs()).not.toThrow()
    } finally {
      unmount()
    }
  })

  it('places #notes-panel as the immediate sibling of #app (legacy.css minimized rule)', () => {
    const { unmount } = renderWithServices(<App />, {})
    try {
      const app = document.querySelector('#app')!
      expect(app.nextElementSibling?.id).toBe('notes-panel')
    } finally {
      unmount()
    }
  })
})
