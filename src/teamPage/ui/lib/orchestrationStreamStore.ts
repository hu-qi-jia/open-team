import type { OrchestrationAutoPlanHistoryEntry } from '../../../group/types'

/*
 * 自动编排流式输出的独立外部 store（原 orchestrationModalView 的
 * autoStreamId / autoPendingUserContent / autoStreamingAssistantContent
 * 三个闭包变量 + handleRuntimeMessage 的对译）。
 *
 * 编排 auto-stream 的 chunk 由 background 经 chrome.runtime.onMessage 推送，
 * 与 appStore（群聊数据）无关——按计划走独立 store，index.tsx 把收到的
 * GROUP_ORCHESTRATION_AUTO_STREAM_CHUNK 原样转交 applyRuntimeChunk，
 * React 组件经 useSyncExternalStore 订阅。streamId 不匹配的 chunk 被忽略
 * （原 handleRuntimeMessage 的 early-return 语义）。
 */

export interface OrchestrationAutoStreamState {
  streamId: string | undefined
  /** 发起生成时的用户输入（气泡在流式期间固定显示） */
  pendingUserContent: string
  /** 已累计的助手流式文本；content 增量优先整体替换（原 content ?? 拼接） */
  assistantContent: string
}

const EMPTY_STATE: OrchestrationAutoStreamState = { streamId: undefined, pendingUserContent: '', assistantContent: '' }

let state: OrchestrationAutoStreamState = EMPTY_STATE
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getOrchestrationAutoStreamState(): OrchestrationAutoStreamState {
  return state
}

export function subscribeOrchestrationAutoStream(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 开始一次自动生成：记录 streamId 与用户输入，清空旧流式文本 */
export function beginOrchestrationAutoStream(streamId: string, userContent: string): void {
  state = { streamId, pendingUserContent: userContent, assistantContent: '' }
  emit()
}

/**
 * 转发 background 的流式 chunk。content 存在时整体替换（background 会发
 * 全量快照），否则拼接增量；streamId 不匹配当前生成时忽略（返回 false）。
 */
export function applyOrchestrationAutoStreamChunk(message: { streamId?: unknown; content?: unknown; chunk?: unknown }): boolean {
  if (typeof message.streamId !== 'string' || message.streamId !== state.streamId) return false
  const content = typeof message.content === 'string' ? message.content : undefined
  const chunk = typeof message.chunk === 'string' ? message.chunk : undefined
  if (!content && !chunk) return true
  state = {
    ...state,
    assistantContent: content ?? `${state.assistantContent}${chunk ?? ''}`,
  }
  emit()
  return true
}

/** 清空流式状态（生成成功落定 / 关闭面板 / 关闭弹窗时；原 clearAutoStreamingState） */
export function endOrchestrationAutoStream(): void {
  state = EMPTY_STATE
  emit()
}

/** 流式期间追加在历史之后的占位两条目（原 currentAutoChatEntries 对译） */
export function pendingAutoStreamEntries(stateSnapshot: OrchestrationAutoStreamState, now = Date.now()): OrchestrationAutoPlanHistoryEntry[] {
  return [
    { id: 'auto-pending-user', role: 'user', content: stateSnapshot.pendingUserContent, createdAt: now },
    { id: 'auto-pending-assistant', role: 'assistant', content: stateSnapshot.assistantContent || '...', createdAt: now },
  ]
}
