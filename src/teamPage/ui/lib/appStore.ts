import type { TeamPageState } from '../../appState'

/*
 * React 侧的外部存储适配层。
 *
 * appState 是原地可变对象（applyStore 整引用替换 .store 字段、其余字段原地写），
 * 所以快照不能依赖对象身份，这里用单调递增版本号驱动 useSyncExternalStore。
 * 框架无关：index.tsx（vanilla 装配侧）只调用 notifyAppState，不感知 React。
 */

let appStateRef: TeamPageState | undefined
let version = 0
const listeners = new Set<() => void>()

/** bootstrap 最早阶段调用，把共享 appState 接入订阅体系。 */
export function bindAppState(state: TeamPageState): void {
  appStateRef = state
}

export function getAppState(): TeamPageState {
  if (!appStateRef) throw new Error('appStore 未绑定：请先调用 bindAppState(appState)')
  return appStateRef
}

export function getAppStateVersion(): number {
  return version
}

export function subscribeAppState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/*
 * applyStore 末尾与旁路更新点（controlStatus 等）调用。
 * queueMicrotask 合并同一 tick 内的多次 applyStore，避免一次命令触发多遍重渲染。
 * 通知虽然延后一拍，selector 直读 appState，同一 tick 内同步读取拿到的仍是新值。
 */
let scheduled = false
export function notifyAppState(): void {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    version += 1
    listeners.forEach(listener => listener())
  })
}
