import { createContext, useContext, type ReactNode } from 'react'
import type { createIframeHost } from '../../iframeHost'
import type { TeamPageRuntimeClient } from '../../runtimeClient'
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
