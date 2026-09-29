import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GroupRole, OrchestrationRun, OrchestrationStageRun } from '../../../../group/types'
import { normalizeLanguage, translateUi } from '../../../../shared/i18n'
import { runCommandWithReconnect } from '../../../sendWithReconnect'
import { useServices } from '../../context/ServicesContext'
import { useFloatingPanelGeometry } from '../../hooks/useFloatingPanelGeometry'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { Button } from '../ui/button'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import {
  STATUS_LABELS,
  buildOrchestrationStatusModel,
  currentStageRun,
  currentNodeText,
  currentStatusText,
  diagramBounds,
  diagramNodes,
  edgeLabelPoint,
  edgePath,
  graphEdges,
  maxExecutions,
  miniNodeLines,
  miniNodeState,
  reviewAttemptCount,
  reviewEdgeBranch,
  reviewMaxAttempts,
  runTaskText,
  stageStatusLabel,
  type OrchestrationStatusModel,
} from '../../lib/orchestrationStatusModel'
import { showError } from '../../lib/toast'

interface FloatingPrefs {
  collapsed?: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}

const FLOATING_PREFS_KEY_PREFIX = 'openteam.orchestrationFloatingStatus.'
const DEFAULT_CARD_WIDTH = 390
const DEFAULT_CARD_HEIGHT = 376
const MIN_CARD_WIDTH = 300
const MIN_CARD_HEIGHT = 220
const MAX_CARD_WIDTH = 720
const MAX_CARD_HEIGHT = 620
const PANEL_MARGIN = 8
const STALE_RUNNING_MS = 10 * 60 * 1000

function readPrefs(chatId: string): FloatingPrefs {
  try {
    const raw = window.localStorage.getItem(`${FLOATING_PREFS_KEY_PREFIX}${chatId}`)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as FloatingPrefs
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function writePrefs(chatId: string, prefs: FloatingPrefs): void {
  window.localStorage.setItem(`${FLOATING_PREFS_KEY_PREFIX}${chatId}`, JSON.stringify(prefs))
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  const safeMax = Math.max(min, max)
  return Math.min(safeMax, Math.max(min, value))
}

function statusLabelText(run: OrchestrationRun): string {
  let label: string = STATUS_LABELS[run.status]
  if (run.status === 'running' && run.updatedAt && Date.now() - run.updatedAt > STALE_RUNNING_MS) label = '编排运行超时'
  return label
}

/*
 * 编排状态浮层卡片（原 orchestrationStatusView 工厂整体 React 化，P4c）。
 * 数据派生（可见 run / 文案 / SVG 迷你流程图几何）全部来自纯模型层
 * orchestrationStatusModel；本组件承担 DOM 与交互：
 * - 拖拽（标题把 ⋮⋮）与缩放（右下把手）走 useFloatingPanelGeometry，
 *   并以 maxWidth/maxHeight 封顶（原 MAX_CARD_* 常量）；
 * - 折叠/位置/尺寸偏好存 localStorage（键含 chatId），在开卡、切群、
 *   折叠切换、换 run 时重放为内联样式——刻意不依赖 store 版本，store
 *   推送只更新内容不回弹几何；
 * - 重试按钮按 `chatId:type:stageId` 去重（原 pendingRetryActions），
 *   继续运行 / 重新运行 / 重发经 runCommandWithReconnect 预连后下发。
 * 无可见 run（或 flow 缺失）时渲染空 slot（原 renderOrchestrationStatus
 * 返回 undefined 对译）。
 */
export function OrchestrationStatusCard() {
  const services = useServices()
  const language = useStoreSelector(state => normalizeLanguage(state.store.settings.language))
  const ui = (source: string) => translateUi(source, language)
  const version = useStoreSelector(getAppStateVersion)
  const selectedChatId = useStoreSelector(state => state.selectedChatId)
  const [prefsTick, setPrefsTick] = useState(0)
  const pendingRetryActions = useRef(new Set<string>())
  const panelRef = useRef<HTMLElement | null>(null)
  const dragHandleRef = useRef<HTMLSpanElement | null>(null)
  const resizeHandleRef = useRef<HTMLButtonElement | null>(null)

  const model = useMemo(() => {
    void version
    const state = getAppState()
    const chat = state.selectedChatId ? state.store.chatsById[state.selectedChatId] : undefined
    if (!chat) return undefined
    const roles = chat.roleIds.map(roleId => state.store.rolesById[roleId]).filter((role): role is GroupRole => Boolean(role))
    return buildOrchestrationStatusModel(state.store, chat, roles)
  }, [version, selectedChatId])

  const chatId = model?.chat.id
  const prefs = useMemo(() => (chatId ? readPrefs(chatId) : {}), [chatId, prefsTick])
  const collapsed = Boolean(prefs.collapsed)

  const geometry = useFloatingPanelGeometry({
    panelRef,
    dragHandleRef,
    resizeHandleRef,
    minWidth: MIN_CARD_WIDTH,
    minHeight: MIN_CARD_HEIGHT,
    maxWidth: MAX_CARD_WIDTH,
    maxHeight: MAX_CARD_HEIGHT,
    margin: 8,
    // S6/T5：.orchestration-status-floating 已转 absolute（S2 铁律：#app 内禁
    // fixed）——拖拽/缩放几何同步迁 #app 坐标系；每次现查 closest 免维护 ref。
    getContainer: () => panelRef.current?.closest('.app-shell') ?? null,
  })

  // 偏好落内联样式（原 applyFloatingPosition + clampViewportPosition 对译）：
  // 宽高钳制到 MIN~MAX，已存 x/y 时改写为 left/top 并按「已知宽高」拉回
  // 视口内——刻意不做 DOM 测量（远处离屏坐标会先缩尺寸再钳位，与原行为
  // 不符），也不依赖 store 版本，store 推送只更新内容不回弹几何
  useEffect(() => {
    const card = panelRef.current
    if (!card || !chatId || collapsed) return
    const cardPrefs = readPrefs(chatId)
    const width = clampNumber(cardPrefs.width ?? DEFAULT_CARD_WIDTH, MIN_CARD_WIDTH, MAX_CARD_WIDTH)
    const height = clampNumber(cardPrefs.height ?? DEFAULT_CARD_HEIGHT, MIN_CARD_HEIGHT, MAX_CARD_HEIGHT)
    card.style.width = `${width}px`
    card.style.height = `${height}px`
    if (typeof cardPrefs.x === 'number' && typeof cardPrefs.y === 'number') {
      // 注意：x/y 当前无写入点（writePrefs 仅 collapse 落盘，位置持久化在
      // React 化时未接回），本分支为原实现保留的死路径；若恢复持久化，
      // 下方 window.innerWidth 钳制需随 S6/T5 的 absolute 一并迁 #app 坐标系。
      const maxLeft = Math.max(PANEL_MARGIN, window.innerWidth - width - PANEL_MARGIN)
      const maxTop = Math.max(PANEL_MARGIN, window.innerHeight - height - PANEL_MARGIN)
      card.style.left = `${Math.min(Math.max(PANEL_MARGIN, cardPrefs.x), maxLeft)}px`
      card.style.top = `${Math.min(Math.max(PANEL_MARGIN, cardPrefs.y), maxTop)}px`
      card.style.right = 'auto'
      card.style.bottom = 'auto'
    }
  }, [chatId, collapsed, model?.run.id, prefsTick])

  if (!model) return <div className="orchestration-status-slot" />

  const { run, flow, chat } = model
  const current = currentStageRun(run)
  const currentStage = current ? flow.stages[current.stageIndex] : undefined

  function updatePrefs(patch: Partial<FloatingPrefs>): void {
    if (!chatId) return
    writePrefs(chatId, { ...readPrefs(chatId), ...patch })
    setPrefsTick(tick => tick + 1)
  }

  function reconnectDeps() {
    return { reconnectRolesForSend: services.reconnectRolesForSend, runCommand: services.runCommand }
  }

  function runAction(type: string, payload: Record<string, unknown>): void {
    services.runCommand(type, payload).catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  function getFlowRoles(statusModel: OrchestrationStatusModel): GroupRole[] {
    const roleIds = new Set(statusModel.flow.stages.flatMap(stage => stage.roleIds))
    return [...roleIds].map(roleId => statusModel.rolesById.get(roleId)).filter((role): role is GroupRole => Boolean(role))
  }

  function getStageRoles(statusModel: OrchestrationStatusModel, stageRun: OrchestrationStageRun): GroupRole[] {
    return Object.keys(stageRun.roleRuns).map(roleId => statusModel.rolesById.get(roleId)).filter((role): role is GroupRole => Boolean(role))
  }

  function getResumeRoles(statusModel: OrchestrationStatusModel): GroupRole[] {
    const active = currentStageRun(statusModel.run)
    if (active && (active.status === 'skipped' || active.status === 'error' || active.status === 'pending' || active.status === 'running')) {
      return getStageRoles(statusModel, active)
    }
    return getFlowRoles(statusModel)
  }

  function rerunAction(statusModel: OrchestrationStatusModel): void {
    const task = runTaskText(statusModel.run, statusModel.store) || statusModel.flow.description || statusModel.flow.name
    runCommandWithReconnect(
      reconnectDeps(),
      { chat: statusModel.chat, roles: getFlowRoles(statusModel), type: 'GROUP_ORCHESTRATION_RUN', payload: { chatId: statusModel.chat.id, flowId: statusModel.flow.id, task }, preconnectAll: true },
    ).catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  function resumeAction(statusModel: OrchestrationStatusModel): void {
    runCommandWithReconnect(
      reconnectDeps(),
      { chat: statusModel.chat, roles: getResumeRoles(statusModel), type: 'GROUP_ORCHESTRATION_RESUME', payload: { chatId: statusModel.chat.id, runId: statusModel.run.id }, preconnectAll: true },
    ).catch(error => showError(error instanceof Error ? error.message : String(error)))
  }

  function retryAction(statusModel: OrchestrationStatusModel, stageRun: OrchestrationStageRun, type: string, payload: Record<string, unknown>): void {
    const actionKey = `${statusModel.chat.id}:${type}:${String(payload.stageId ?? '')}`
    if (pendingRetryActions.current.has(actionKey)) return
    pendingRetryActions.current.add(actionKey)
    runCommandWithReconnect(reconnectDeps(), { chat: statusModel.chat, roles: getStageRoles(statusModel, stageRun), type, payload, preconnectAll: true })
      .catch(error => showError(error instanceof Error ? error.message : String(error)))
      .finally(() => pendingRetryActions.current.delete(actionKey))
  }

  const statusActions: ReactNode[] = []
  if (run.status === 'stopped') {
    statusActions.push(
      <Button key="resume" type="button" size="xs" onClick={() => resumeAction(model)}>{ui('继续')}</Button>,
      <Button key="rerun-stopped" type="button" variant="ghost" size="xs" onClick={() => rerunAction(model)}>{ui('重新运行')}</Button>,
    )
  }
  if (run.status === 'completed') {
    statusActions.push(
      <Button key="rerun-completed" type="button" size="xs" onClick={() => rerunAction(model)}>{ui('重新运行')}</Button>,
    )
  }
  if ((run.status === 'error' || current?.status === 'error') && current) {
    statusActions.push(
      current.kind === 'review'
        ? <Button key="retry-review" type="button" size="xs" onClick={() => retryAction(model, current, 'GROUP_ORCHESTRATION_RETRY_REVIEW', { chatId: chat.id })}>{ui('重发')}</Button>
        : <Button key="retry-stage" type="button" size="xs" onClick={() => retryAction(model, current, 'GROUP_ORCHESTRATION_RETRY_STAGE', { chatId: chat.id, stageId: current.stageId })}>{ui('重发')}</Button>,
      <Button key="skip" type="button" variant="ghost" size="xs" onClick={() => runAction('GROUP_ORCHESTRATION_SKIP_STAGE', { chatId: chat.id, stageId: current.stageId })}>{ui('跳过节点')}</Button>,
      <Button key="rerun-error" type="button" variant="ghost" size="xs" onClick={() => rerunAction(model)}>{ui('重新运行')}</Button>,
    )
  }
  if (run.status === 'running' && run.updatedAt && Date.now() - run.updatedAt > STALE_RUNNING_MS) {
    statusActions.push(
      <Button key="force-reset" type="button" variant="destructive" size="xs" onClick={() => runAction('GROUP_ORCHESTRATION_STOP', { chatId: chat.id })}>{ui('强制重置')}</Button>,
    )
  }

  const waitingNextIndex = current ? current.stageIndex + 1 : run.stageRuns.length
  const waitingLabels = (run.status === 'running' || run.status === 'pending')
    ? flow.stages.slice(waitingNextIndex).map(stage => stageStatusLabel(stage, model.rolesById, model.store))
    : []

  const miniNodes = diagramNodes(flow)
  const miniEdges = graphEdges(flow)
  const miniBounds = diagramBounds(miniNodes, miniEdges)
  const miniNodeById = new Map(miniNodes.map(node => [node.stage.id, node]))

  return (
    <div className="orchestration-status-slot">
      {collapsed ? (
        <button
          type="button"
          className={`orchestration-status orchestration-status-floating orchestration-status-collapsed orchestration-status-${run.status}`}
          title={`${ui(statusLabelText(run))} · ${ui(currentNodeText(run, flow))} · ${run.stageRuns.length} / ${maxExecutions(run)}`}
          aria-label={`${ui(statusLabelText(run))} · ${ui(currentNodeText(run, flow))} · ${run.stageRuns.length} / ${maxExecutions(run)}，点击展开`}
          onClick={() => updatePrefs({ collapsed: false })}
        >{ui('编')}</button>
      ) : (
        <section
          ref={panelRef}
          className={`orchestration-status orchestration-status-floating orchestration-status-${run.status}`}
          data-run-id={run.id}
          aria-label={ui('编排运行状态')}
        >
          <div className="orchestration-status-header" onPointerDown={geometry.onDragPointerDown}>
            <div className="orchestration-status-title">
              <span ref={dragHandleRef} className="orchestration-status-drag-grip">⋮⋮</span>
              <span>{ui(statusLabelText(run))}</span>
            </div>
            <div className="orchestration-status-window-actions">
              {statusActions.length > 0 && <div className="orchestration-status-actions">{statusActions}</div>}
              <Button type="button" variant="ghost" size="icon-xs" className="orchestration-status-collapse" aria-label={ui('收起编排状态')} onClick={() => updatePrefs({ collapsed: true })}>－</Button>
              {(run.status === 'running' || run.status === 'pending') && (
                <Button type="button" variant="destructive" size="xs" onClick={() => runAction('GROUP_ORCHESTRATION_STOP', { chatId: chat.id })}>{ui('停止')}</Button>
              )}
            </div>
          </div>
          <div className="orchestration-status-body">
            <div className="orchestration-status-progress">
              <div className="orchestration-status-count">
                <strong>{run.stageRuns.length} / {maxExecutions(run)}</strong>
                <span>{ui('已执行节点数')}</span>
              </div>
              <div className="orchestration-status-node-index">
                {ui(`节点 ${current ? current.stageIndex + 1 : Math.min(run.stageRuns.length + 1, flow.stages.length)} / ${Math.max(1, flow.stages.length)}`)}
              </div>
            </div>
            {current && currentStage && (
              <div className="orchestration-status-current">
                <div className="orchestration-status-current-label">{current.status === 'error' ? ui('失败节点') : ui('当前节点')}</div>
                <div className="orchestration-status-current-main">
                  {currentStage.kind === 'review'
                    ? ui(`审核 · ${stageStatusLabel(currentStage, model.rolesById, model.store)}`)
                    : ui(stageStatusLabel(currentStage, model.rolesById, model.store))}
                </div>
                <div className="orchestration-status-current-sub">
                  {currentStage.description?.trim() || ui(currentStatusText(current))}
                </div>
                {currentStage.kind === 'review' && (
                  <div className="orchestration-status-review-meta">
                    <span>{ui(`审核次数 ${reviewAttemptCount(run, currentStage.id)} / ${reviewMaxAttempts(currentStage)}`)}</span>
                    <span>{currentStage.review?.onMaxAttempts === 'continue' ? ui('上限后：继续往下走') : ui('上限后：停止流程')}</span>
                  </div>
                )}
              </div>
            )}
            {waitingLabels.length > 0 && (
              <div className="orchestration-status-waiting">
                <span>{ui('等待')}</span>
                <strong>{waitingLabels.map(label => ui(label)).join('、')}</strong>
              </div>
            )}
            <svg
              className="orchestration-mini-flow"
              role="img"
              aria-label={ui('编排流程示意图')}
              viewBox={`${miniBounds.x} ${miniBounds.y} ${miniBounds.width} ${miniBounds.height}`}
            >
              <defs>
                <marker
                  id={`orchestration-mini-arrow-${run.id}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {miniEdges.map((edge, index) => {
                const source = miniNodeById.get(edge.sourceStageId)
                const target = miniNodeById.get(edge.targetStageId)
                if (!source || !target) return null
                const branch = reviewEdgeBranch(edge, flow.stages)
                const labelPoint = branch ? edgeLabelPoint(source, target, edge) : undefined
                return (
                  <g key={`edge-${index}`}>
                    <path
                      className={`orchestration-mini-edge${branch ? ` branch-${branch}` : ''}`}
                      d={edgePath(source, target, edge)}
                      markerEnd={`url(#orchestration-mini-arrow-${run.id})`}
                    />
                    {branch && labelPoint && (
                      <g className="orchestration-mini-edge-label">
                        <rect x={labelPoint.x - 24} y={labelPoint.y - 12} width="48" height="20" rx="8" />
                        <text x={labelPoint.x} y={labelPoint.y + 3} textAnchor="middle">{branch === 'pass' ? ui('通过') : ui('不通过')}</text>
                      </g>
                    )}
                  </g>
                )
              })}
              {miniNodes.map(node => {
                const state = miniNodeState(run, node.stage.id)
                const nodeClassName = [
                  'orchestration-mini-node',
                  state.current ? 'current' : '',
                  state.completed ? 'completed' : '',
                  state.error ? 'error' : '',
                ].filter(Boolean).join(' ')
                return node.stage.kind === 'review' ? (
                  <polygon
                    key={node.stage.id}
                    data-node-id={node.stage.id}
                    className={nodeClassName}
                    points={[
                      `${node.x + node.width / 2},${node.y}`,
                      `${node.x + node.width},${node.y + node.height / 2}`,
                      `${node.x + node.width / 2},${node.y + node.height}`,
                      `${node.x},${node.y + node.height / 2}`,
                    ].join(' ')}
                  />
                ) : (
                  <rect
                    key={node.stage.id}
                    data-node-id={node.stage.id}
                    className={nodeClassName}
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx="14"
                  />
                )
              })}
              {miniNodes.map(node => (
                <g key={`label-${node.stage.id}`} className="orchestration-mini-label">
                  {miniNodeLines(node.stage, model.store, model.rolesById, run).map((line, lineIndex) => {
                    const startY = node.y + node.height / 2 - (miniNodeLines(node.stage, model.store, model.rolesById, run).length - 1) * 8
                    return (
                      <text
                        key={lineIndex}
                        x={node.x + node.width / 2}
                        y={startY + lineIndex * 17}
                        textAnchor="middle"
                      >{line}</text>
                    )
                  })}
                </g>
              ))}
            </svg>
          </div>
          <button
            ref={resizeHandleRef}
            type="button"
            className="orchestration-status-resize"
            aria-label={ui('调整编排状态大小')}
            onPointerDown={geometry.onResizePointerDown}
          />
        </section>
      )}
    </div>
  )
}
