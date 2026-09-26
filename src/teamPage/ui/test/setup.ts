import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// 项目未开启 vitest globals，RTL 的自动 cleanup 不生效，这里显式注册。
afterEach(() => {
  cleanup()
})

/*
 * RTL / Radix 组件在 jsdom 下缺失的浏览器 API 桩。
 * setupFiles 对所有测试环境生效，node 环境测试（无 window）直接跳过，无副作用。
 */
if (typeof window !== 'undefined') {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    })
  }

  if (!('ResizeObserver' in window)) {
    class ResizeObserverStub {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverStub })
  }

  if (!window.PointerEvent) {
    Object.defineProperty(window, 'PointerEvent', { writable: true, value: window.MouseEvent })
  }

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
    Element.prototype.setPointerCapture = () => {}
    Element.prototype.releasePointerCapture = () => {}
  }

  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }

  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {}
  }
}
