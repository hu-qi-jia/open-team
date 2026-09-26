import { useRef, useSyncExternalStore } from 'react'
import { getAppState, getAppStateVersion, subscribeAppState } from '../lib/appStore'
import type { TeamPageState } from '../../appState'

/*
 * appStore 的 React 订阅入口。
 *
 * selector 约定：返回原始值（Object.is 判等）或稳定引用（如 store 对象本身）；
 * 返回派生数组时必须传 isEqual（如 shallowEqual），否则每次通知都会重渲染。
 * 内部按版本号缓存上次快照，保证 getSnapshot 幂等（useSyncExternalStore 的硬要求）。
 */
export function useStoreSelector<T>(
  selector: (state: TeamPageState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const lastRef = useRef<{ version: number; value: T } | undefined>(undefined)

  const getSnapshot = (): T => {
    const version = getAppStateVersion()
    const cached = lastRef.current
    if (cached && cached.version === version) return cached.value

    const next = selector(getAppState())
    if (cached && isEqual(cached.value, next)) {
      lastRef.current = { version, value: cached.value }
      return cached.value
    }
    lastRef.current = { version, value: next }
    return next
  }

  return useSyncExternalStore(subscribeAppState, getSnapshot, getSnapshot)
}
