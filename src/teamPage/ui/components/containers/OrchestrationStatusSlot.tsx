import { useEffect, useRef } from 'react'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { getAppStateVersion } from '../../lib/appStore'
import { useServices } from '../../context/ServicesContext'

/*
 * 编排状态浮层的挂载点（原 renderMessages 里把 renderOrchestrationStatus()
 * 产物 append 到 #messages 首位一节的对译）。
 * orchestrationStatusView 工厂保持不变（P4 才收编）：本组件只在 store
 * 版本变化时调用工厂重建浮层子树（与原「每次 renderMessages 重建」节奏
 * 一致，拖拽/折叠偏好由工厂自己经 localStorage 恢复）。
 * 浮层本体是 .orchestration-status-floating（position:fixed，legacy.css），
 * 包一层普通 div 不影响其定位。
 */
export function OrchestrationStatusSlot() {
  const services = useServices()
  useStoreSelector(getAppStateVersion)
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const next = services.messageActions.renderOrchestrationStatus()
    host.replaceChildren(...(next ? [next] : []))
  })

  return <div ref={hostRef} className="orchestration-status-slot" />
}
