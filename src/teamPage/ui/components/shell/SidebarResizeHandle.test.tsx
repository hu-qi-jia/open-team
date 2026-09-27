// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, SIDEBAR_DEFAULT_WIDTH } from '../../hooks/useSidebarPrefs'

function storedWidth(): number {
  return JSON.parse(window.localStorage.getItem('openteam.sidebar')!).width
}

describe('SidebarResizeHandle', () => {
  beforeEach(() => window.localStorage.clear())

  it('按指针增量调宽并钳制在 200–320', () => {
    render(<SidebarResizeHandle />)
    const handle = document.querySelector('.sidebar-resize-handle')!
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 + 9999 })
    expect(storedWidth()).toBe(SIDEBAR_MAX_WIDTH)
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 - 99999 })
    expect(storedWidth()).toBe(SIDEBAR_MIN_WIDTH)
    fireEvent.pointerUp(handle, { pointerId: 1 })
  })

  it('双击重置 240', () => {
    render(<SidebarResizeHandle />)
    const handle = document.querySelector('.sidebar-resize-handle')!
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 160 })
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(storedWidth()).not.toBe(SIDEBAR_DEFAULT_WIDTH)
    fireEvent.doubleClick(handle)
    expect(storedWidth()).toBe(SIDEBAR_DEFAULT_WIDTH)
  })
})
