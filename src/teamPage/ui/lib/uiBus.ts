/*
 * legacy → React 的反向 UI 命令通道。
 *
 * 迁移期 vanilla 视图（messagesView 空群引导等）仍需要触发 React 侧弹窗；
 * React 的 <Dialogs> 挂载时订阅 uiBus，视图 React 化后原函数指针改指 uiBus.emit。
 * 两个命令式模块（floatingWindow / roleRecoveryController）之间直连，不经此总线。
 */

export type UiCommand =
  | 'open-add-person'
  | 'open-external-models'
  | 'open-orchestration'
  | 'open-all-notes'
  | 'open-temporary-person'

export interface UiBus {
  on(command: UiCommand, handler: () => void): () => void
  emit(command: UiCommand): void
}

export function createUiBus(): UiBus {
  const handlers = new Map<UiCommand, Set<() => void>>()
  return {
    on(command, handler) {
      const bucket = handlers.get(command) ?? new Set<() => void>()
      bucket.add(handler)
      handlers.set(command, bucket)
      return () => {
        bucket.delete(handler)
      }
    },
    emit(command) {
      handlers.get(command)?.forEach(handler => handler())
    },
  }
}
