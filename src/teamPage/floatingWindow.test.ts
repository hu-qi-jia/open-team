// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createTeamPageState } from './appState'
import { createFloatingWindowControls } from './floatingWindow'
import { bindAppState } from './ui/lib/appStore'
import { SHELL_GEOMETRY_STORAGE_KEY } from './shellGeometry'

// 铬件文案语言与 useT 同源：读 appStore 绑定的共享 state（语言切换即生效）。
function bindUiLanguage(language: 'en' | 'zh-CN'): void {
  const state = createTeamPageState()
  state.store.settings.language = language
  bindAppState(state)
}

function mockShellRect(el: HTMLElement, width: number, height = 600): void {
  el.getBoundingClientRect = () => ({
    width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect)
}

describe('team page floating window boundary', () => {
  it('keeps drag and minimize controls outside the entrypoint', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.tsx'), 'utf8')
    const viewSource = readFileSync(resolve(process.cwd(), 'src/teamPage/floatingWindow.ts'), 'utf8')

    expect(viewSource).toContain('function ensureShellPositioned(): DOMRect')
    expect(viewSource).toContain('function moveShellTo(left: number, top: number): void')
    expect(viewSource).toContain('function resizeShellTo(width: number, height: number): void')
    expect(viewSource).toContain('function clampShellPosition(): void')
    expect(viewSource).toContain('function setWindowMinimized(minimized: boolean): void')
    expect(viewSource).toContain('function registerFloatingWindowControls(): void')
    expect(entrySource).not.toContain('function ensureShellPositioned(): DOMRect')
    expect(entrySource).not.toContain('function moveShellTo(left: number, top: number): void')
    expect(entrySource).not.toContain('function resizeShellTo(width: number, height: number): void')
    expect(entrySource).not.toContain('function clampShellPosition(): void')
    expect(entrySource).not.toContain('function registerFloatingWindowControls(): void')
  })

  // 全屏钮的 aria-label/title 由 vanilla 侧在每次状态翻转时改写（React 只提供
  // 初始值），文案必须走翻译表且语言取自绑定 store——否则英文界面下第一次
  // 切换全屏就会被写回中文（S2 R1 评审裁定修复）。
  it('writes fullscreen chrome labels translated in the bound store language (en)', () => {
    bindUiLanguage('en')
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')

    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    toggleFullscreenEl.click()

    expect(appShellEl.classList.contains('fullscreen')).toBe(true)
    expect(toggleFullscreenEl.getAttribute('aria-pressed')).toBe('true')
    expect(toggleFullscreenEl.getAttribute('aria-label')).toBe('Exit fullscreen')
    expect(toggleFullscreenEl.title).toBe('Exit fullscreen')

    toggleFullscreenEl.click()

    expect(appShellEl.classList.contains('fullscreen')).toBe(false)
    expect(toggleFullscreenEl.getAttribute('aria-pressed')).toBe('false')
    expect(toggleFullscreenEl.getAttribute('aria-label')).toBe('Fullscreen window')
    expect(toggleFullscreenEl.title).toBe('Fullscreen window')
  })

  it('writes fullscreen chrome labels in Chinese for a zh-CN bound store', () => {
    bindUiLanguage('zh-CN')
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')

    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    toggleFullscreenEl.click()
    expect(toggleFullscreenEl.getAttribute('aria-label')).toBe('退出全屏')
    expect(toggleFullscreenEl.title).toBe('退出全屏')

    toggleFullscreenEl.click()
    expect(toggleFullscreenEl.getAttribute('aria-label')).toBe('全屏窗口')
    expect(toggleFullscreenEl.title).toBe('全屏窗口')
  })

  it('leaves fullscreen mode when minimized', () => {
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')

    const controls = createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    })

    controls.registerFloatingWindowControls()
    toggleFullscreenEl.click()
    controls.setWindowMinimized(true)

    expect(appShellEl.classList.contains('fullscreen')).toBe(false)
    expect(appShellEl.classList.contains('minimized')).toBe(true)
    expect(toggleFullscreenEl.getAttribute('aria-pressed')).toBe('false')
  })

  it('minimizes the whole floating shell from the top-right close affordance', () => {
    const appShellEl = document.createElement('main')
    const closeWindowEl = document.createElement('button')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')

    createFloatingWindowControls({
      appShellEl,
      closeWindowEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    closeWindowEl.click()

    expect(appShellEl.classList.contains('minimized')).toBe(true)
    expect(windowLauncherEl.hidden).toBe(false)
    expect(toggleWindowSizeEl.getAttribute('aria-expanded')).toBe('false')
  })

  it('drags the window from the top chrome without a dedicated drag handle', () => {
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')
    const titlebarEl = document.createElement('header')
    appShellEl.append(titlebarEl)
    document.body.append(appShellEl)
    Object.defineProperty(appShellEl, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 80,
        right: 700,
        bottom: 580,
        width: 600,
        height: 500,
        x: 100,
        y: 80,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    appShellEl.setPointerCapture = () => undefined
    appShellEl.releasePointerCapture = () => undefined
    appShellEl.hasPointerCapture = () => true

    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    titlebarEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 180, clientY: 96, pointerId: 1, bubbles: true }))
    appShellEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 126, pointerId: 1, bubbles: true }))

    expect(appShellEl.style.left).toBe('140px')
    expect(appShellEl.style.top).toBe('110px')
    expect(appShellEl.classList.contains('dragging')).toBe(true)
  })

  it('does not start dragging from toolbar buttons', () => {
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')
    appShellEl.append(toggleWindowSizeEl)
    document.body.append(appShellEl)
    Object.defineProperty(appShellEl, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 80,
        right: 700,
        bottom: 580,
        width: 600,
        height: 500,
        x: 100,
        y: 80,
        toJSON: () => ({}),
      }),
    })

    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    toggleWindowSizeEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 120, clientY: 96, pointerId: 1, bubbles: true }))
    appShellEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 126, pointerId: 1, bubbles: true }))

    expect(appShellEl.style.left).toBe('')
    expect(appShellEl.style.top).toBe('')
    expect(appShellEl.classList.contains('dragging')).toBe(false)
  })

  it('resizes the floating shell from the resize handle with minimum dimensions', () => {
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')
    const windowResizeHandleEl = document.createElement('button')
    appShellEl.append(windowResizeHandleEl)
    document.body.append(appShellEl)
    Object.defineProperty(appShellEl, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 80,
        right: 1000,
        bottom: 700,
        width: 900,
        height: 620,
        x: 100,
        y: 80,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    windowResizeHandleEl.setPointerCapture = () => undefined
    windowResizeHandleEl.releasePointerCapture = () => undefined
    windowResizeHandleEl.hasPointerCapture = () => true

    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
      windowResizeHandleEl,
    }).registerFloatingWindowControls()

    windowResizeHandleEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 1000, clientY: 700, pointerId: 1, bubbles: true }))
    windowResizeHandleEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 320, pointerId: 1, bubbles: true }))

    expect(appShellEl.style.width).toBe('520px')
    expect(appShellEl.style.height).toBe('480px')
    expect(appShellEl.classList.contains('resizing')).toBe(true)
  })

  it('does not persist shell geometry when fullscreen is entered before the persistence timer fires', () => {
    vi.useFakeTimers()
    try {
      const appShellEl = document.createElement('main')
      const toggleWindowSizeEl = document.createElement('button')
      const toggleFullscreenEl = document.createElement('button')
      const windowLauncherEl = document.createElement('button')
      const windowResizeHandleEl = document.createElement('button')
      appShellEl.append(windowResizeHandleEl)
      document.body.append(appShellEl)
      Object.defineProperty(appShellEl, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          left: 100,
          top: 80,
          right: 1000,
          bottom: 700,
          width: 900,
          height: 620,
          x: 100,
          y: 80,
          toJSON: () => ({}),
        }),
      })
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
      localStorage.removeItem(SHELL_GEOMETRY_STORAGE_KEY)

      createFloatingWindowControls({
        appShellEl,
        toggleWindowSizeEl,
        toggleFullscreenEl,
        windowLauncherEl,
        windowResizeHandleEl,
      }).registerFloatingWindowControls()

      windowResizeHandleEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 1000, clientY: 700, pointerId: 1, bubbles: true }))
      windowResizeHandleEl.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 1000, clientY: 700, pointerId: 1, bubbles: true }))
      toggleFullscreenEl.click()

      // 同文件早前用例可能留下未触发的真实定时器写入，同步清掉以隔离本断言
      localStorage.removeItem(SHELL_GEOMETRY_STORAGE_KEY)
      vi.advanceTimersByTime(300)

      expect(localStorage.getItem(SHELL_GEOMETRY_STORAGE_KEY)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores persisted left and top when leaving fullscreen', () => {
    vi.useFakeTimers()
    try {
      const appShellEl = document.createElement('main')
      const toggleWindowSizeEl = document.createElement('button')
      const toggleFullscreenEl = document.createElement('button')
      const windowLauncherEl = document.createElement('button')
      const titlebarEl = document.createElement('header')
      appShellEl.append(titlebarEl)
      document.body.append(appShellEl)
      Object.defineProperty(appShellEl, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          left: 100,
          top: 80,
          right: 700,
          bottom: 580,
          width: 600,
          height: 500,
          x: 100,
          y: 80,
          toJSON: () => ({}),
        }),
      })
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
      appShellEl.setPointerCapture = () => undefined
      appShellEl.releasePointerCapture = () => undefined
      appShellEl.hasPointerCapture = () => true
      localStorage.removeItem(SHELL_GEOMETRY_STORAGE_KEY)

      createFloatingWindowControls({
        appShellEl,
        toggleWindowSizeEl,
        toggleFullscreenEl,
        windowLauncherEl,
      }).registerFloatingWindowControls()

      // 拖动后等 debounce 落盘（jsdom 下 currentGeometry 读到的是上面的桩矩形）
      titlebarEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 180, clientY: 96, pointerId: 1, bubbles: true }))
      appShellEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 126, pointerId: 1, bubbles: true }))
      appShellEl.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 220, clientY: 126, pointerId: 1, bubbles: true }))
      vi.advanceTimersByTime(300)
      const persisted = JSON.parse(localStorage.getItem(SHELL_GEOMETRY_STORAGE_KEY)!) as { left: number; top: number }
      expect(persisted).toEqual({ left: 100, top: 80, width: 600, height: 500 })

      // 进入全屏清掉 left/top 内联样式，退出后两者都必须从持久化几何恢复
      toggleFullscreenEl.click()
      expect(appShellEl.style.left).toBe('')
      expect(appShellEl.style.top).toBe('')

      toggleFullscreenEl.click()

      expect(appShellEl.classList.contains('fullscreen')).toBe(false)
      expect(appShellEl.style.left).toBe(`${persisted.left}px`)
      expect(appShellEl.style.top).toBe(`${persisted.top}px`)
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes pending geometry persist on pagehide', () => {
    vi.useFakeTimers()
    try {
      const appShellEl = document.createElement('main')
      const toggleWindowSizeEl = document.createElement('button')
      const toggleFullscreenEl = document.createElement('button')
      const windowLauncherEl = document.createElement('button')
      const titlebarEl = document.createElement('header')
      appShellEl.append(titlebarEl)
      document.body.append(appShellEl)
      Object.defineProperty(appShellEl, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          left: 100,
          top: 80,
          right: 700,
          bottom: 580,
          width: 600,
          height: 500,
          x: 100,
          y: 80,
          toJSON: () => ({}),
        }),
      })
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
      appShellEl.setPointerCapture = () => undefined
      appShellEl.releasePointerCapture = () => undefined
      appShellEl.hasPointerCapture = () => true
      localStorage.removeItem(SHELL_GEOMETRY_STORAGE_KEY)

      createFloatingWindowControls({
        appShellEl,
        toggleWindowSizeEl,
        toggleFullscreenEl,
        windowLauncherEl,
      }).registerFloatingWindowControls()

      // 拖动结束即挂起一笔 300ms 后才落盘的持久化
      titlebarEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 180, clientY: 96, pointerId: 1, bubbles: true }))
      appShellEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 126, pointerId: 1, bubbles: true }))
      appShellEl.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 220, clientY: 126, pointerId: 1, bubbles: true }))

      // jsdom 的 Storage 是代理，spyOn(localStorage, 'setItem') 截不到真实写入，
      // 与同文件既有用例一致改断言存储内容
      window.dispatchEvent(new Event('pagehide'))

      expect(localStorage.getItem(SHELL_GEOMETRY_STORAGE_KEY)).toBe(
        JSON.stringify({ left: 100, top: 80, width: 600, height: 500 }),
      )

      // 冲刷必须同步清掉挂起定时器：清空后推进 300ms 不允许再写一次
      localStorage.removeItem(SHELL_GEOMETRY_STORAGE_KEY)
      vi.advanceTimersByTime(300)
      expect(localStorage.getItem(SHELL_GEOMETRY_STORAGE_KEY)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pagehide with no pending persist does not write', async () => {
    // 早前用例（拖动/拉伸）会遗留 300ms 真实持久化定时器与对应的 pagehide
    // 监听，先用真实时钟放掉，避免陈旧监听在下方同步断言窗口内抢写。
    await new Promise(resolve => setTimeout(resolve, 350))

    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')
    document.body.append(appShellEl)

    localStorage.removeItem(SHELL_GEOMETRY_STORAGE_KEY)
    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    window.dispatchEvent(new Event('pagehide'))

    expect(localStorage.getItem(SHELL_GEOMETRY_STORAGE_KEY)).toBeNull()
  })
})

describe('data-app-size 同步', () => {
  it('syncAppSizeTier 按壳宽写入档位', () => {
    // 沿用上方用例的内联 deps 构造方式
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')

    const controls = createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    })

    mockShellRect(appShellEl, 900)
    controls.syncAppSizeTier()
    expect(appShellEl.dataset.appSize).toBe('medium')
    mockShellRect(appShellEl, 640)
    controls.syncAppSizeTier()
    expect(appShellEl.dataset.appSize).toBe('compact')
    mockShellRect(appShellEl, 1200)
    controls.syncAppSizeTier()
    expect(appShellEl.dataset.appSize).toBe('wide')
  })
})
