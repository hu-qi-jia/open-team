import { describe, expect, it } from 'vitest'
import type { GroupMessage, GroupRole, MessageHighlight, OrchestrationReviewResult } from '../../../group/types'
import { DEFAULT_MESSAGE_HIGHLIGHT_COLOR } from '../../../group/highlightColors'
import { computeMessageSignature, isStructuredFailureReason, messageFailureText, shouldRenderMarkdownMessage } from './messageSignature'

/*
 * 行为锁：签名字段清单与原 messagesView.messageSignature 完全一致——
 * 下列任一字段漂移必须产生不同签名（流式复用等价性的前提）。
 */
describe('computeMessageSignature', () => {
  it('same message state produces an identical signature', () => {
    const inputs = makeInputs()
    expect(computeMessageSignature(inputs)).toBe(computeMessageSignature(makeInputs()))
  })

  it('content / status / attachments changes produce new signatures', () => {
    expect(computeMessageSignature({ ...makeInputs(), message: { ...message, content: '变了' } }))
      .not.toBe(baseSignature)
    expect(computeMessageSignature({ ...makeInputs(), message: { ...message, status: 'error' } }))
      .not.toBe(baseSignature)
    expect(computeMessageSignature({
      ...makeInputs(),
      message: { ...message, attachments: [{ id: 'img-1', type: 'image', status: 'ready', alt: 'a' }] },
    })).not.toBe(baseSignature)
  })

  it('role site and compaction flags affect the signature', () => {
    const role: GroupRole = { ...makeInputs().role!, chatSite: 'chatgpt' }
    expect(computeMessageSignature({ ...makeInputs(), role })).not.toBe(baseSignature)
    expect(computeMessageSignature({ ...makeInputs(), showName: false })).not.toBe(baseSignature)
    expect(computeMessageSignature({ ...makeInputs(), showAvatar: false })).not.toBe(baseSignature)
  })

  it('review results and highlights affect the signature', () => {
    const reviewResult: OrchestrationReviewResult = {
      messageId: message.id,
      decision: 'fail',
      failedCriteria: ['缺数据'],
      reason: 'r',
      nextRoundInstruction: 'x',
      round: 1,
      stageRunId: 'stage-run-1',
      rawJson: '{}',
      createdAt: 1,
    }
    const highlights: MessageHighlight[] = [{ id: 'h1', messageId: message.id, text: '排期', startOffset: 0, endOffset: 2, color: DEFAULT_MESSAGE_HIGHLIGHT_COLOR, createdAt: 1 }]
    expect(computeMessageSignature({ ...makeInputs(), reviewResult })).not.toBe(baseSignature)
    expect(computeMessageSignature({ ...makeInputs(), highlights })).not.toBe(baseSignature)
  })

  it('mention metadata affects the signature', () => {
    expect(computeMessageSignature({ ...makeInputs(), message: { ...message, mentionsAll: true } }))
      .not.toBe(baseSignature)
    expect(computeMessageSignature({ ...makeInputs(), message: { ...message, mentionedRoleIds: ['role-2'] } }))
      .not.toBe(baseSignature)
  })
})

describe('message body helpers', () => {
  it('assistant messages default to markdown; user needs an explicit format', () => {
    expect(shouldRenderMarkdownMessage(message)).toBe(true)
    expect(shouldRenderMarkdownMessage({ ...message, type: 'user' })).toBe(false)
    expect(shouldRenderMarkdownMessage({ ...message, type: 'user', contentFormat: 'markdown' })).toBe(true)
  })

  it('structured failure reasons map to diagnostic copy', () => {
    expect(isStructuredFailureReason('Timeout')).toBe(true)
    expect(isStructuredFailureReason('其他错误')).toBe(false)
    expect(messageFailureText({ ...message, content: 'send_failed' })).toContain('发送失败')
    expect(messageFailureText({ ...message, content: '站点挂了' })).toBe('回复失败：站点挂了')
  })
})

const message: GroupMessage = {
  id: 'msg-1',
  chatId: 'chat-1',
  seq: 1,
  type: 'assistant',
  roleId: 'role-1',
  roleName: '工程师',
  content: '排期：周一冻结需求',
  createdAt: 1000,
  status: 'received',
}

const role: GroupRole = {
  id: 'role-1',
  chatId: 'chat-1',
  name: '工程师',
  status: 'ready',
  contextCursor: 0,
  createdAt: 1,
  updatedAt: 1,
  chatSite: 'gemini',
}

function makeInputs() {
  return {
    message: { ...message },
    showName: true,
    showAvatar: true,
    role: { ...role },
    reviewResult: undefined,
    highlights: undefined,
  }
}

const baseSignature = computeMessageSignature(makeInputs())
