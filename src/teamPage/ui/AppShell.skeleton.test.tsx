// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { App } from './App'
import { renderWithServices } from './test/TestProviders'

/*
 * 绞杀者模式的核心契约回归网：React AppShell 渲染出的 DOM 必须带上
 * index.tsx 的 vanilla 模块装配（floatingWindow / iframeHost）仍要查询的
 * 全部 id。任何一侧漂移（删掉了壳层组件里的 id，或装配里改了选择器）
 * 都会在这里立刻爆掉，而不是运行时白屏。与 index.tsx 的 requireElement(...)
 * 清单一一对应（主题按钮 theme-light/theme-dark 已退役：入口移入设置菜单）。
 * 'chat-list'（ChatList 容器）与 'quick-create-chat'（快速建群触发钮）由
 * AppShellFrame 的统一侧栏承接。
 */
const VANILLA_MODULE_IDS = [
  'app',
  'close-window',
  'toggle-window-size',
  'toggle-fullscreen',
  'window-launcher',
  'window-resize-handle',
  'window-resize-handle-right',
  'window-resize-handle-bottom',
  'iframe-host',
  'chat-list',
  'quick-create-chat',
] as const

describe('App shell', () => {
  it('renders every id the vanilla module assembly requires', () => {
    const { unmount } = renderWithServices(<App />, {})
    try {
      for (const id of VANILLA_MODULE_IDS) {
        expect(document.getElementById(id), `missing #${id}`).not.toBeNull()
      }
    } finally {
      unmount()
    }
  })

  it('renders the unified sidebar and no legacy rail', () => {
    const { unmount } = renderWithServices(<App />, {})
    try {
      expect(document.querySelector('[data-sidebar="sidebar"]')).not.toBeNull()
      expect(document.querySelector('.rail')).toBeNull()
      const app = document.getElementById('app')!
      expect(['compact', 'medium', 'wide']).toContain(app.dataset.appSize)
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
