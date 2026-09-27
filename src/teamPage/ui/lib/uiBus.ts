/*
 * React 侧组件间的 UI 命令通道（P4d 起无 vanilla 订阅方）。
 *
 * 快速建群弹层的「从模板中创建」触发 <GroupTemplateModal/> 打开；模板确认
 * 后弹窗经 'close-create-chat-popover' 收回快速建群表单——两个方向的
 * 发布/订阅方都是 React 组件（各自只订阅一次）。Rail 入口、消息流空态、
 * 成员抽屉表单等触发 React 侧弹窗；携带参数的命令（编辑指定人员 / 查看
 * 内置人员详情）约定为「先写 appState（selectedTemplateId /
 * previewTemplateId）再 emit」。
 * 两个命令式模块（floatingWindow / roleRecoveryController）之间直连，不经此总线。
 */

export type UiCommand =
  | 'open-add-person'
  | 'open-external-models'
  | 'open-orchestration'
  | 'open-all-notes'
  | 'open-temporary-person'
  | 'open-people-library'
  | 'open-person-template-edit'
  | 'open-builtin-template-detail'
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
