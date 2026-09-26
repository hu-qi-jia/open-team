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
 */
export interface TeamPageServices {
  runCommand: TeamPageRuntimeClient['runCommand']
  sendRuntimeMessage: TeamPageRuntimeClient['sendRuntimeMessage']
  iframeHost: IframeHostInstance
  imageAttachmentRepository: ImageAttachmentRepository
  uiBus: UiBus
  log: OpenTeamLogger
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
