// src/teamPage/ui/hooks/useAppShellChrome.ts
import { useEffect, useState } from 'react'
import type { AppSizeTier } from '../../appSizeTier'

/*
 * 订阅 #app 上的 vanilla 壳层状态（floatingWindow 只写 DOM，不进 React 状态）：
 * - data-app-size：档位（floatingWindow 派生写入）
 * - class：minimized / fullscreen
 * 用 MutationObserver + state 订阅；snapshot 直接取属性/class 派生值。
 */

function requireAppShell(): HTMLElement {
  const el = document.getElementById('app')
  if (!el) throw new Error('#app 尚未挂载：useAppShellChrome 系列只能在 App 树内使用')
  return el
}

function tierFromAttr(attr: string | null): AppSizeTier {
  return attr === 'compact' || attr === 'medium' || attr === 'wide' ? attr : 'wide'
}

export function useAppSizeTier(): AppSizeTier {
  const [tier, setTier] = useState<AppSizeTier>(() => tierFromAttr(document.getElementById('app')?.getAttribute('data-app-size') ?? null))

  useEffect(() => {
    const app = requireAppShell()
    const observer = new MutationObserver(() => setTier(tierFromAttr(app.getAttribute('data-app-size'))))
    observer.observe(app, { attributes: true, attributeFilter: ['data-app-size'] })
    return () => observer.disconnect()
  }, [])

  return tier
}

export interface AppShellChromeState {
  minimized: boolean
  fullscreen: boolean
}

export function useAppShellChromeState(): AppShellChromeState {
  const read = (): AppShellChromeState => ({
    minimized: document.getElementById('app')?.classList.contains('minimized') ?? false,
    fullscreen: document.getElementById('app')?.classList.contains('fullscreen') ?? false,
  })
  const [state, setState] = useState<AppShellChromeState>(read)

  useEffect(() => {
    const app = requireAppShell()
    const observer = new MutationObserver(() => setState(read()))
    observer.observe(app, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return state
}
