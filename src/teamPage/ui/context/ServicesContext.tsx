import { createContext, useContext, type ReactNode } from 'react'
import type { createIframeHost } from '../../iframeHost'
import type { TeamPageRuntimeClient } from '../../runtimeClient'
import type { GroupChat, GroupMessage, GroupRole } from '../../../group/types'
import type { ImageAttachmentRepository } from '../../../shared/imageAttachmentRepository'
import type { OpenTeamLogger } from '../../../shared/logger'
import type { UiBus } from '../lib/uiBus'

type IframeHostInstance = ReturnType<typeof createIframeHost>

/*
 * 组件树内唯一的服务入口：所有 chrome.* / 命令式模块访问都经这里注入，
 * 组件自身保持纯函数化——RTL 测试只需提供假 services，无需 mock chrome。
 * value 在 index.tsx 装配完成后即恒定，不参与渲染。
 *
 * 访问纪律：服务方法（runCommand / sendRuntimeMessage 等）只在事件处理器与
 * effect 中调用，不在渲染期解构——index.tsx 的 services 对 iframeHost 用
 * getter 延迟解引用（其创建依赖 domRefs），渲染期解构 getter 字段会因
 * TDZ 直接崩掉首帧（P1 白屏根因）。mountOrder 边界测试锁住装配顺序。
 */
export interface TeamPageServices {
  runCommand: TeamPageRuntimeClient['runCommand']
  sendRuntimeMessage: TeamPageRuntimeClient['sendRuntimeMessage']
  iframeHost: IframeHostInstance
  imageAttachmentRepository: ImageAttachmentRepository
  uiBus: UiBus
  log: OpenTeamLogger
  /** 切群编排（chatSwitcher）：本地选中态 + vanilla 重渲 + rAF 去抖发命令 */
  switchChat(chatId: string): void
  /** 群聊破坏性操作（chatListActions）：需要触碰 messageNodeCache / applyStore */
  chatOperations: {
    clearMessages(chatId: string): Promise<void>
    deleteChat(chatId: string): Promise<void>
  }
  /** 发送前自动恢复人员连接（roleRecoveryController.reconnectRolesForSend） */
  reconnectRolesForSend(chat: GroupChat, roles: GroupRole[]): Promise<void>
  /**
   * 输入区桥（P2c）：Composer 挂载后注册命令式 API（插入提及 / 设置引用），
   * 供 messageActions 与未迁移的 vanilla 视图（rolePanelView）复用。
   * 只允许在事件期调用；注册本身发生在 Composer 的 mount effect。
   */
  composerBridge: {
    register(api: {
      insertMention(role: GroupRole): void
      setReference(message: GroupMessage): void
    }): void
  }
  /**
   * 消息动作组（P2b）：消息流组件的事件期出口。全部方法只允许在事件
   * 处理器 / effect 中调用（index.tsx 以闭包延迟解引用 vanilla 能力，
   * 渲染期调用会在装配完成前踩到占位实现）。
   */
  messageActions: {
    /** @ 插入输入框（composerView.insertMention） */
    insertMention(role: GroupRole): void
    /** 设置引用回复（composerView.setReference） */
    setReference(message: GroupMessage): void
    /** 划词插入当前笔记（notesView.insertTextIntoActiveNote） */
    insertTextIntoActiveNote(text: string): void
    /** 重新同步完整回复（roleRecoveryController.resyncMessageReply） */
    resyncMessageReply(message: GroupMessage): Promise<void>
    /** 重发 / 重新回复（roleRecoveryController.retryRoleReply） */
    retryRoleReply(role: GroupRole, messageId?: string): Promise<void>
    /** 停止回复（roleRecoveryController.stopRoleReply） */
    stopRoleReply(role: GroupRole): Promise<void>
    /** 跳转到角色原始 iframe（roleRecoveryController.focusRoleFrame） */
    focusRoleFrame(chatId: string, roleId: string | undefined): void
    /** 编排状态浮层（orchestrationStatusView 工厂，P4 收编前保留） */
    renderOrchestrationStatus(): HTMLElement | undefined
  }
}

const ServicesContext = createContext<TeamPageServices | undefined>(undefined)

export function ServicesProvider({ services, children }: { services: TeamPageServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}

export function useServices(): TeamPageServices {
  const services = useContext(ServicesContext)
  if (!services) throw new Error('ServicesProvider 缺失：组件必须在 <ServicesProvider> 内渲染')
  return services
}
