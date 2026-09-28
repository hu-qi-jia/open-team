import { useEffect, useRef } from 'react'
import type { OrchestrationGraphSnapshot, OrchestrationStage } from '../../../../group/types'
import { createOrchestrationCanvas, type OrchestrationCanvas } from '../../../orchestrationCanvas'
import { useServices } from '../../context/ServicesContext'
import { getAppState } from '../../lib/appStore'
import { roleModelDisplay } from '../../lib/orchestrationDraft'
import { showError } from '../../lib/toast'

export interface CanvasPortalProps {
  stages: OrchestrationStage[]
  selectedStageId?: string
  graphEdges: OrchestrationGraphSnapshot['edges']
  /**
   * 结构签名（节点 id/kind/名称/人员/位置 + 边的端口拓扑）：仅结构变化
   * 才重建图。任务描述、审核标准等纯草稿字段的编辑不进入签名——原视图
   * 只在节点名称输入时重画画布，描述输入不重画，此处保持一致。
   */
  canvasKey: string
  /** store 版本：角色改名 / 站点变化等 store 侧数据也要刷新画布标签 */
  storeVersion: number
  onStageSelected(stageId: string): void
  onRoleDropped(roleId: string): void
  onGraphChanged(edges: OrchestrationGraphSnapshot['edges']): void
}

/*
 * 编排画布容器（原 orchestrationModalView.mountCanvas + render 尾部的
 * canvas.render 对译）。X6 是命令式模块（保留不动），本组件持有其生命周期：
 * - 挂载即 createOrchestrationCanvas + mount（异步加载 X6；加载完成后用
 *   latest ref 里的最新草稿补一次 render，避免加载窗口期的编辑丢失）；
 * - canvasKey / storeVersion 变化 → canvas.render；selectedStageId 故意
 *   不入依赖——选中态走 selectStage 属性改写，不重建图（原「选中节点
 *   不重建画布」的断言锁定行为）；
 * - 卸载（关弹窗）→ canvas.destroy（原 close() 的 canvas?.destroy 对译）。
 * 拖拽入画布（dragover/drop）由 orchestrationCanvas 自己在 rootEl 上监听。
 */
export function CanvasPortal({ stages, selectedStageId, graphEdges, canvasKey, storeVersion, onStageSelected, onRoleDropped, onGraphChanged }: CanvasPortalProps) {
  const services = useServices()
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<OrchestrationCanvas | undefined>(undefined)
  const latestRef = useRef({ stages, selectedStageId, graphEdges })
  latestRef.current = { stages, selectedStageId, graphEdges }
  const callbacksRef = useRef({ onStageSelected, onRoleDropped, onGraphChanged })
  callbacksRef.current = { onStageSelected, onRoleDropped, onGraphChanged }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const canvas = createOrchestrationCanvas({
      rootEl: host,
      getRoleName: roleId => getAppState().store.rolesById[roleId]?.name ?? '未知人员',
      getRoleSiteLabel: roleId => {
        const store = getAppState().store
        const role = store.rolesById[roleId]
        return role ? roleModelDisplay(role, store).label : ''
      },
      onStageSelected(stageId) {
        callbacksRef.current.onStageSelected(stageId)
      },
      onRoleDropped(roleId) {
        callbacksRef.current.onRoleDropped(roleId)
      },
      onGraphChanged(edges) {
        callbacksRef.current.onGraphChanged(edges)
      },
      loadX6: services.loadX6,
    })
    canvasRef.current = canvas
    let cancelled = false
    canvas.mount(latestRef.current.stages, latestRef.current.selectedStageId, latestRef.current.graphEdges)
      .then(() => {
        if (cancelled) return
        // X6 异步加载窗口内草稿可能已变化，用最新值补一次渲染
        canvas.render(latestRef.current.stages, latestRef.current.selectedStageId, latestRef.current.graphEdges)
      })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
      canvasRef.current = undefined
      canvas.destroy()
    }
    // 画布生命周期与弹窗开合同步；services/callbacks 经 ref 读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    canvasRef.current?.render(latestRef.current.stages, latestRef.current.selectedStageId, latestRef.current.graphEdges)
  }, [canvasKey, storeVersion])

  useEffect(() => {
    canvasRef.current?.selectStage(selectedStageId)
  }, [selectedStageId])

  // 尺寸由 utilities 提供（原 legacy `.orchestration-stage-canvas` 的
  // width/height:100% + min-height:0）；类名保留作 runtime 钩子。
  return <div id="orchestration-stage-canvas" className="orchestration-stage-canvas size-full min-h-0" ref={hostRef} />
}
