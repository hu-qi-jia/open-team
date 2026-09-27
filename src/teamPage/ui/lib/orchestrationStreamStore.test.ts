import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyOrchestrationAutoStreamChunk,
  beginOrchestrationAutoStream,
  endOrchestrationAutoStream,
  getOrchestrationAutoStreamState,
  pendingAutoStreamEntries,
  subscribeOrchestrationAutoStream,
} from './orchestrationStreamStore'

/*
 * 自动编排流式 store 单测（原 orchestrationModalView 的 autoStream 闭包
 * 变量语义）：streamId 匹配才生效、content 整体替换优先于 chunk 拼接、
 * 结束即复位、占位条目在空文本时回落 '...'。
 */

afterEach(() => {
  endOrchestrationAutoStream()
})

describe('orchestration auto stream store', () => {
  it('starts from an empty state with no stream id', () => {
    expect(getOrchestrationAutoStreamState()).toEqual({ streamId: undefined, pendingUserContent: '', assistantContent: '' })
  })

  it('records the stream id and user content when a generation begins', () => {
    beginOrchestrationAutoStream('stream-1', '帮我编排')

    expect(getOrchestrationAutoStreamState()).toEqual({ streamId: 'stream-1', pendingUserContent: '帮我编排', assistantContent: '' })
  })

  it('replaces assistant content wholesale when a chunk carries a full snapshot', () => {
    beginOrchestrationAutoStream('stream-1', '任务')
    applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', content: '第一版' })
    applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', content: '第二版' })

    expect(getOrchestrationAutoStreamState().assistantContent).toBe('第二版')
  })

  it('appends incremental chunks when no snapshot content is present', () => {
    beginOrchestrationAutoStream('stream-1', '任务')
    applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', chunk: '你好' })
    applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', chunk: '，世界' })

    expect(getOrchestrationAutoStreamState().assistantContent).toBe('你好，世界')
  })

  it('ignores chunks whose stream id does not match the active generation', () => {
    beginOrchestrationAutoStream('stream-1', '任务')

    expect(applyOrchestrationAutoStreamChunk({ streamId: 'stream-other', chunk: '迷路' })).toBe(false)
    expect(applyOrchestrationAutoStreamChunk({ chunk: '无 id' })).toBe(false)
    expect(getOrchestrationAutoStreamState().assistantContent).toBe('')
  })

  it('accepts empty chunks as no-ops without changing the text', () => {
    beginOrchestrationAutoStream('stream-1', '任务')
    applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', chunk: '已有' })

    expect(applyOrchestrationAutoStreamChunk({ streamId: 'stream-1' })).toBe(true)
    expect(applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', content: 42, chunk: null })).toBe(true)
    expect(getOrchestrationAutoStreamState().assistantContent).toBe('已有')
  })

  it('resets to the empty state when the stream ends', () => {
    beginOrchestrationAutoStream('stream-1', '任务')
    applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', chunk: '文本' })

    endOrchestrationAutoStream()

    expect(getOrchestrationAutoStreamState()).toEqual({ streamId: undefined, pendingUserContent: '', assistantContent: '' })
  })

  it('notifies subscribers on changes and stops after unsubscribing', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeOrchestrationAutoStream(listener)

    beginOrchestrationAutoStream('stream-1', '任务')
    applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', chunk: 'x' })
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', chunk: 'y' })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('builds pending chat entries with an ellipsis fallback for empty assistant text', () => {
    beginOrchestrationAutoStream('stream-1', '帮我编排')

    const before = pendingAutoStreamEntries(getOrchestrationAutoStreamState(), 1234)
    expect(before).toEqual([
      { id: 'auto-pending-user', role: 'user', content: '帮我编排', createdAt: 1234 },
      { id: 'auto-pending-assistant', role: 'assistant', content: '...', createdAt: 1234 },
    ])

    applyOrchestrationAutoStreamChunk({ streamId: 'stream-1', chunk: '草稿文本' })
    expect(pendingAutoStreamEntries(getOrchestrationAutoStreamState(), 5678)[1]).toEqual({
      id: 'auto-pending-assistant',
      role: 'assistant',
      content: '草稿文本',
      createdAt: 5678,
    })
  })
})
