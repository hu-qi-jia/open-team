// src/teamPage/ui/hooks/useSidebarPrefs.ts
import { useCallback, useSyncExternalStore } from 'react'

/*
 * 侧栏偏好（规格 §5.2 修订）：localStorage 键 openteam.sidebar。
 * width 钳制 200–320（自绘拖宽手柄用，§5.2：官方 Resizable 只支持
 * 百分比约束），双击重置 240。userOpen 为用户手动开合覆盖，
 * undefined = 跟随档位默认（wide 展开 / medium 图标条 / compact 隐藏）。
 * 模块级单例 store：AppShellFrame、ChatHeader、拖宽手柄等多个消费者
 * 共享同一份状态——per-hook useState 会导致实例间失联（唤出按钮写了
 * 状态但侧栏读不到）。
 */
const SIDEBAR_PREFS_KEY = 'openteam.sidebar'
export const SIDEBAR_MIN_WIDTH = 200
export const SIDEBAR_MAX_WIDTH = 320
export const SIDEBAR_DEFAULT_WIDTH = 240

export interface SidebarPrefs {
  width: number
  userOpen?: boolean
}

function clampWidth(width: number): number {
  return Math.min(Math.max(SIDEBAR_MIN_WIDTH, width), SIDEBAR_MAX_WIDTH)
}

export function readSidebarPrefsFromStorage(): SidebarPrefs {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PREFS_KEY)
    if (!raw) return { width: SIDEBAR_DEFAULT_WIDTH }
    const parsed = JSON.parse(raw) as Partial<SidebarPrefs>
    return {
      width: typeof parsed.width === 'number' ? clampWidth(parsed.width) : SIDEBAR_DEFAULT_WIDTH,
      userOpen: typeof parsed.userOpen === 'boolean' ? parsed.userOpen : undefined,
    }
  } catch {
    return { width: SIDEBAR_DEFAULT_WIDTH }
  }
}

let prefs: SidebarPrefs = readSidebarPrefsFromStorage()
const listeners = new Set<() => void>()

function updatePrefs(next: SidebarPrefs): void {
  prefs = next
  try {
    window.localStorage.setItem(SIDEBAR_PREFS_KEY, JSON.stringify(next))
  } catch {
    // 隐私模式可能拒绝 localStorage；偏好只在会话内生效。
  }
  for (const listener of listeners) listener()
}

export function useSidebarPrefs() {
  const state = useSyncExternalStore(
    listener => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    () => prefs,
  )

  const setWidth = useCallback((width: number) => {
    updatePrefs({ ...prefs, width: clampWidth(width) })
  }, [])
  const resetWidth = useCallback(() => {
    updatePrefs({ ...prefs, width: SIDEBAR_DEFAULT_WIDTH })
  }, [])
  const setUserOpen = useCallback((userOpen: boolean) => {
    updatePrefs({ ...prefs, userOpen })
  }, [])

  return { width: state.width, userOpen: state.userOpen, setWidth, resetWidth, setUserOpen }
}
