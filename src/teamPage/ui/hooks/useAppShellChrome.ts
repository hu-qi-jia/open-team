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
    const sync = (): void => setTier(tierFromAttr(app.getAttribute('data-app-size')))
    // 挂载即对齐一次：闭掉「观察者就位前的写入」漏渲窗口；档位未变时
    // React 按值判等跳过，不产生多余重渲。
    sync()
    const observer = new MutationObserver(sync)
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
    // class 变化一律函数式更新出「全新快照对象」：任何字段变化（包括与渲染
    // 输出无关的 class 写入，如拖拽期 dragging）都必然以新引用通知消费者，
    // 不会因字段值未变被 React 判等吞掉（S1 清账回归锁定该行为）。
    const observer = new MutationObserver(() => setState(() => read()))
    // 挂载即对齐一次：闭掉「观察者就位前的 class 写入」漏渲窗口；快照未变时
    // 返回旧引用，React 判等跳过，不产生多余重渲。
    setState(prev => {
      const next = read()
      return prev.minimized === next.minimized && prev.fullscreen === next.fullscreen ? prev : next
    })
    observer.observe(app, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return state
}
