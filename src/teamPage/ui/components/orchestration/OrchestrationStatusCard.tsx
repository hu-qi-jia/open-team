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
 *
 * S7/T2：视觉全量 utilities 化（legacy.css 状态卡族退役）——暗色基线 + 浅色
 * 补丁按「亮色默认 + dark: 覆盖」单份表达；run.status 挂 data-status，状态
 * 色用 data-[status=*]: 变体（暗色差异用 data-[status=*]:dark: 嵌套变体，
 * 嵌套在 utilities 层内排序靠后，稳定压过单变体与基础类）。orchestration-
 * status* / orchestration-mini-* 类名全部保留为测试与探针钩子（含 SVG 节点
 * 的 current/completed/error、边的 branch-pass/fail）。mini-node 态 stroke
 * 亮色不生效是原 CSS 特异性现状（浅色 :root 前缀组压过态规则），以「态色
 * 只挂 dark:」保真重现；current 与 error 并存时 current 胜（复刻 CSS 源序）。
 */

/* run.status 状态色调（原 legacy .orchestration-status-error/stopped/completed
 * 暗 + 浅双份）。挂 data-status 变体；error 的暗色差异用嵌套变体表达。 */
const STATUS_TINT_CLASSES: Record<string, string> = {
  error:
    'data-[status=error]:border-[rgba(198,56,85,0.28)] data-[status=error]:bg-[#fff1f3]' +
    ' data-[status=error]:dark:border-[rgba(255,138,165,0.38)] data-[status=error]:dark:bg-[rgba(44,12,22,0.88)]',
  stopped: 'data-[status=stopped]:border-[rgba(248,184,78,0.34)]',
  completed: 'data-[status=completed]:border-[rgba(83,230,166,0.34)]',
}
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
          data-status={run.status}
          className={[
            'orchestration-status orchestration-status-floating orchestration-status-collapsed',
            `orchestration-status-${run.status}`,
            // 原 legacy .orchestration-status-floating/-collapsed（暗基线 + 浅补丁）：
            // 亮色白底圆钮为默认，dark: 恢复暗色基线（shadow 两态不同，单独写）。
            'absolute right-[22px] bottom-[206px] z-[8]',
            'inline-flex h-[46px] min-h-[46px] w-[46px] min-w-[46px] max-w-[46px] items-center justify-center overflow-hidden p-0',
            'rounded-full border border-zinc-500/30 bg-white text-zinc-950',
            'shadow-[0_24px_58px_rgba(63,63,70,0.16),0_0_0_1px_rgba(113,113,122,0.08)_inset]',
            'cursor-pointer text-[15px] font-[820]',
            'dark:border-zinc-400/40 dark:bg-zinc-950/95 dark:text-zinc-200',
            'dark:shadow-[0_12px_34px_rgba(0,0,0,0.42),0_0_18px_rgba(212,212,216,0.24)]',
            STATUS_TINT_CLASSES[run.status] ?? '',
          ].join(' ')}
          title={`${ui(statusLabelText(run))} · ${ui(currentNodeText(run, flow))} · ${run.stageRuns.length} / ${maxExecutions(run)}`}
          aria-label={`${ui(statusLabelText(run))} · ${ui(currentNodeText(run, flow))} · ${run.stageRuns.length} / ${maxExecutions(run)}，点击展开`}
          onClick={() => updatePrefs({ collapsed: false })}
        >{ui('编')}</button>
      ) : (
        <section
          ref={panelRef}
          data-status={run.status}
          className={[
            'orchestration-status orchestration-status-floating',
            `orchestration-status-${run.status}`,
            // 原 legacy .orchestration-status-floating（暗基线 559-575 + 浅补丁
            // 1609-1615）：S6/T5 的 absolute 定位随族迁入，s6-7 锚点断言继续覆盖。
            'absolute right-[70px] bottom-[128px] z-[8]',
            'flex flex-col box-border min-h-[220px] min-w-[300px]',
            'overflow-hidden rounded-2xl border border-zinc-500/30 bg-white text-zinc-950',
            'shadow-[0_24px_58px_rgba(63,63,70,0.16),0_0_0_1px_rgba(113,113,122,0.08)_inset]',
            'backdrop-blur-[18px]',
            'dark:border-zinc-400/40 dark:bg-zinc-950/95 dark:text-zinc-200',
            'dark:shadow-[0_24px_70px_rgba(0,0,0,0.42),0_0_0_1px_rgba(161,161,170,0.08)_inset]',
            STATUS_TINT_CLASSES[run.status] ?? '',
          ].join(' ')}
          data-run-id={run.id}
          aria-label={ui('编排运行状态')}
        >
          <div
            className="orchestration-status-header flex min-h-[46px] cursor-move select-none items-start justify-between gap-2 border-b border-zinc-500/15 bg-white py-2 pl-3.5 pr-2.5 dark:border-zinc-300/15 dark:bg-zinc-300/10"
            onPointerDown={geometry.onDragPointerDown}
          >
            <div className="orchestration-status-title inline-flex min-h-[30px] min-w-0 flex-[1_1_140px] items-center gap-2 text-[13px] font-[860] text-zinc-950 dark:text-zinc-200">
              <span ref={dragHandleRef} className="orchestration-status-drag-grip text-[14px] tracking-[1px] text-muted-foreground">⋮⋮</span>
              <span>{ui(statusLabelText(run))}</span>
            </div>
            <div className="orchestration-status-window-actions flex flex-none flex-wrap items-center justify-end gap-2 max-w-[min(420px,64%)]">
              {statusActions.length > 0 && <div className="orchestration-status-actions flex flex-wrap items-center justify-end gap-2">{statusActions}</div>}
              <Button type="button" variant="ghost" size="icon-xs" className="orchestration-status-collapse w-[26px] bg-white p-0 text-zinc-600 dark:bg-[rgba(11,22,34,0.92)] dark:text-zinc-400" aria-label={ui('收起编排状态')} onClick={() => updatePrefs({ collapsed: true })}>－</Button>
              {(run.status === 'running' || run.status === 'pending') && (
                <Button type="button" variant="destructive" size="xs" onClick={() => runAction('GROUP_ORCHESTRATION_STOP', { chatId: chat.id })}>{ui('停止')}</Button>
              )}
            </div>
          </div>
          <div className="orchestration-status-body grid min-h-0 flex-[1_1_auto] grid-rows-[auto_auto_auto_minmax(110px,1fr)] gap-2.5 overflow-auto px-3.5 pb-3.5 pt-[13px]">
            <div className="orchestration-status-progress flex items-end justify-between gap-3">
              <div className="orchestration-status-count grid gap-[3px]">
                <strong className="text-[22px] font-black leading-[1.05] text-white">{run.stageRuns.length} / {maxExecutions(run)}</strong>
                <span className="text-xs font-[760] leading-[1.4] text-muted-foreground">{ui('已执行节点数')}</span>
              </div>
              <div className="orchestration-status-node-index text-xs font-[760] leading-[1.4] text-muted-foreground">
                {ui(`节点 ${current ? current.stageIndex + 1 : Math.min(run.stageRuns.length + 1, flow.stages.length)} / ${Math.max(1, flow.stages.length)}`)}
              </div>
            </div>
            {current && currentStage && (
              <div className="orchestration-status-current grid gap-[5px] rounded-xl border border-zinc-500/20 bg-white px-3 py-2.5 text-zinc-800 dark:border-zinc-300/20 dark:bg-zinc-300/10 dark:text-zinc-200">
                <div className="orchestration-status-current-label text-xs font-[760] leading-[1.4] text-muted-foreground">{current.status === 'error' ? ui('失败节点') : ui('当前节点')}</div>
                <div className="orchestration-status-current-main truncate text-[15px] font-[860] leading-[1.35] text-zinc-950 dark:text-zinc-100">
                  {currentStage.kind === 'review'
                    ? ui(`审核 · ${stageStatusLabel(currentStage, model.rolesById, model.store)}`)
                    : ui(stageStatusLabel(currentStage, model.rolesById, model.store))}
                </div>
                <div className="orchestration-status-current-sub text-xs font-[760] leading-[1.4] text-muted-foreground">
                  {currentStage.description?.trim() || ui(currentStatusText(current))}
                </div>
                {currentStage.kind === 'review' && (
                  <div className="orchestration-status-review-meta mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full border border-zinc-500/20 bg-white px-2 py-1 font-[840] text-zinc-800 dark:border-zinc-300/25 dark:bg-zinc-300/10 dark:text-zinc-200">{ui(`审核次数 ${reviewAttemptCount(run, currentStage.id)} / ${reviewMaxAttempts(currentStage)}`)}</span>
                    <span>{currentStage.review?.onMaxAttempts === 'continue' ? ui('上限后：继续往下走') : ui('上限后：停止流程')}</span>
                  </div>
                )}
              </div>
            )}
            {waitingLabels.length > 0 && (
              <div className="orchestration-status-waiting flex min-w-0 items-center gap-2 text-xs leading-[1.35] text-muted-foreground">
                <span className="shrink-0 font-[760] text-zinc-500">{ui('等待')}</span>
                <strong className="min-w-0 truncate font-[780] text-muted-foreground">{waitingLabels.map(label => ui(label)).join('、')}</strong>
              </div>
            )}
            <svg
              className="orchestration-mini-flow h-full min-h-[118px] w-full overflow-visible rounded-[14px] border border-zinc-500/15 bg-white dark:bg-zinc-950"
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
                  <path className="fill-zinc-300" d="M 0 0 L 10 5 L 0 10 z" />
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
                      className={[
                        'orchestration-mini-edge fill-none stroke-2 stroke-zinc-300 [stroke-linecap:round] [stroke-linejoin:round]',
                        branch ? `branch-${branch} ${branch === 'pass' ? 'opacity-[0.82]' : 'opacity-[0.92]'}` : '',
                      ].filter(Boolean).join(' ')}
                      d={edgePath(source, target, edge)}
                      markerEnd={`url(#orchestration-mini-arrow-${run.id})`}
                    />
                    {branch && labelPoint && (
                      <g className="orchestration-mini-edge-label">
                        <rect className="fill-white stroke-zinc-300/50 dark:fill-zinc-900" x={labelPoint.x - 24} y={labelPoint.y - 12} width="48" height="20" rx="8" />
                        <text className="fill-[#0e6f54] text-[11px] font-[820] [dominant-baseline:middle] dark:fill-zinc-300" x={labelPoint.x} y={labelPoint.y + 3} textAnchor="middle">{branch === 'pass' ? ui('通过') : ui('不通过')}</text>
                      </g>
                    )}
                  </g>
                )
              })}
              {miniNodes.map(node => {
                const state = miniNodeState(run, node.stage.id)
                // 态色 utilities 按 current > completed > error 互斥拼接（原 CSS
                // 源序 current 胜 error）；态色只挂 dark: = 保真重现浅色 :root
                // 组压过态规则的特异性现状。语义类名保留为测试/探针钩子。
                const stateTint = state.current
                  ? 'dark:stroke-[3px] dark:stroke-zinc-300 dark:[filter:drop-shadow(0_0_10px_rgba(212,212,216,0.42))]'
                  : state.completed
                    ? 'dark:stroke-zinc-300/75'
                    : state.error
                      ? 'dark:stroke-[#ff8aa5]'
                      : ''
                const nodeClassName = [
                  'orchestration-mini-node fill-white stroke-2 stroke-zinc-500 dark:fill-[#1c1c1f]',
                  state.current ? 'current' : '',
                  state.completed ? 'completed' : '',
                  state.error ? 'error' : '',
                  stateTint,
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
                <g key={`label-${node.stage.id}`} className="orchestration-mini-label pointer-events-none">
                  {miniNodeLines(node.stage, model.store, model.rolesById, run).map((line, lineIndex) => {
                    const startY = node.y + node.height / 2 - (miniNodeLines(node.stage, model.store, model.rolesById, run).length - 1) * 8
                    return (
                      <text
                        key={lineIndex}
                        className="fill-zinc-800 text-[12px] font-[820] [dominant-baseline:middle] dark:fill-zinc-200"
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
            className="orchestration-status-resize absolute bottom-[7px] right-[7px] h-3.5 w-3.5 cursor-[nwse-resize] border-0 bg-[linear-gradient(135deg,transparent_0_45%,rgba(212,212,216,0.5)_46%_54%,transparent_55%),linear-gradient(135deg,transparent_0_66%,rgba(212,212,216,0.35)_67%_75%,transparent_76%)]"
            aria-label={ui('调整编排状态大小')}
            onPointerDown={geometry.onResizePointerDown}
          />
        </section>
      )}
    </div>
  )
}
