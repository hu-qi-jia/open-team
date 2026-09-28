// src/teamPage/ui/hooks/useSidebarPrefs.test.ts
// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH,
  readSidebarPrefsFromStorage, resetSidebarPrefsForTests, useSidebarPrefs,
} from './useSidebarPrefs'

describe('useSidebarPrefs', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('默认宽度 240、userOpen 未定义', () => {
    const { result } = renderHook(() => useSidebarPrefs())
    expect(result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH)
    expect(result.current.userOpen).toBeUndefined()
  })

  it('setWidth 钳制 200–320，且多个消费者共享同一 store', () => {
    const a = renderHook(() => useSidebarPrefs())
    const b = renderHook(() => useSidebarPrefs())
    act(() => a.result.current.setWidth(999))
    expect(a.result.current.width).toBe(SIDEBAR_MAX_WIDTH)
    expect(b.result.current.width).toBe(SIDEBAR_MAX_WIDTH) // 实例间同源
    act(() => b.result.current.setWidth(80))
    expect(a.result.current.width).toBe(SIDEBAR_MIN_WIDTH)
    expect(JSON.parse(window.localStorage.getItem('openteam.sidebar')!)).toMatchObject({ width: SIDEBAR_MIN_WIDTH })
  })

  it('resetWidth 回 240；setUserOpen 持久化布尔覆盖', () => {
    const { result } = renderHook(() => useSidebarPrefs())
    act(() => result.current.setWidth(300))
    act(() => result.current.resetWidth())
    expect(result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH)
    act(() => result.current.setUserOpen(false))
    expect(result.current.userOpen).toBe(false)
    expect(JSON.parse(window.localStorage.getItem('openteam.sidebar')!)).toMatchObject({ userOpen: false })
  })

  it('readSidebarPrefsFromStorage 读取持久化并钳制，损坏数据回默认', () => {
    window.localStorage.setItem('openteam.sidebar', JSON.stringify({ width: 9999, userOpen: true }))
    expect(readSidebarPrefsFromStorage()).toEqual({ width: SIDEBAR_MAX_WIDTH, userOpen: true })
    window.localStorage.setItem('openteam.sidebar', '{oops')
    expect(readSidebarPrefsFromStorage()).toEqual({ width: SIDEBAR_DEFAULT_WIDTH, userOpen: undefined })
  })

  // 模块单例（模块加载时即按 localStorage 初始化）会跨测试文件串状态：
  // 本用例先改写偏好，再断言 resetSidebarPrefsForTests 恢复初始字面量，
  // 且订阅中的其他消费者实例收到通知（对齐「单例 store」用例的双实例写法）。
  it('resetSidebarPrefsForTests 恢复单例默认值并通知订阅者', () => {
    const a = renderHook(() => useSidebarPrefs())
    const b = renderHook(() => useSidebarPrefs())
    act(() => a.result.current.setWidth(300))
    act(() => a.result.current.setUserOpen(false))
    expect(a.result.current.width).toBe(300)
    expect(a.result.current.userOpen).toBe(false)

    act(() => resetSidebarPrefsForTests())

    expect(a.result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH)
    expect(a.result.current.userOpen).toBeUndefined()
    expect(b.result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH) // 通知触达全部实例
    expect(b.result.current.userOpen).toBeUndefined()
  })
})
