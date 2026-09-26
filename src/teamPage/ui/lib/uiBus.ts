/*
 * legacy ↔ React 的 UI 命令通道。
 *
 * React → vanilla：快速建群弹层的「从模板中创建」触发 teamUiController 的
 *   群模板弹窗（React 侧只在 index.tsx 装配处订阅一次）。
 * vanilla → React：迁移期 vanilla 视图（messagesView 空群引导等）触发 React
 *   侧弹窗；对应视图 React 化后原函数指针改指 uiBus.emit。
 * 两个命令式模块（floatingWindow / roleRecoveryController）之间直连，不经此总线。
 */

export type UiCommand =
  | 'open-add-person'
  | 'open-external-models'
  | 'open-orchestration'
  | 'open-all-notes'
  | 'open-temporary-person'
  | 'open-group-template-create'
  | 'close-create-chat-popover'

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
