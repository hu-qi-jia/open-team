import type { GroupMessage, GroupRole, MessageHighlight, OrchestrationReviewResult } from '../../../group/types'

/*
 * 消息签名（原 messagesView.messageSignature 原样迁移，参数化外部查询）。
 * MessageItem 的 memo 比较键：签名不变 → 跳过整棵气泡子树的协调。
 * 等价替代原 messageNodeCache 的流式复用——签名拼接触碰的字段与原实现
 * 逐一相同，任何字段漂移（含 role 站点、复核结果、高亮、压缩态）都会
 * 产生新签名并触发该气泡重渲。
 */
export interface MessageSignatureInputs {
  message: GroupMessage
  showName: boolean
  showAvatar: boolean
  /** roleForMessage 的解析结果：rolesById[message.roleId] 且 chatId 匹配 */
  role: GroupRole | undefined
  /** findReviewResultForMessage 的解析结果 */
  reviewResult: OrchestrationReviewResult | undefined
  /** store.messageHighlightsById[message.id] */
  highlights: MessageHighlight[] | undefined
}

export function computeMessageSignature(inputs: MessageSignatureInputs): string {
  const { message, showName, showAvatar, role, reviewResult, highlights } = inputs
  return JSON.stringify({
    type: message.type,
    roleId: message.roleId,
    roleName: message.roleName,
    roleSite: role?.chatSite,
    content: message.content,
    contentFormat: message.contentFormat,
    attachments: message.attachments,
    createdAt: message.createdAt,
    status: message.status,
    references: message.references,
    orchestrationRunId: message.orchestrationRunId,
    orchestrationRound: message.orchestrationRound,
    orchestrationStageId: message.orchestrationStageId,
    orchestrationStageIndex: message.orchestrationStageIndex,
    orchestrationKind: message.orchestrationKind,
    orchestrationReviewResult: reviewResult,
    highlights,
    targetRoleIds: message.targetRoleIds,
    mentionedRoleIds: message.mentionedRoleIds,
    mentionsAll: message.mentionsAll,
    showName,
    showAvatar,
  })
}

export function shouldRenderMarkdownMessage(message: GroupMessage): boolean {
  return message.contentFormat === 'markdown' || message.type === 'assistant'
}

function getDiagnosticText(reason: string): string {
  const normalized = reason.toLowerCase()
  if (normalized === 'send_failed') return '⚠️ 发送失败，请检查 AI 窗口是否开启或尝试刷新页面。'
  if (normalized === 'response_not_found') return '⚠️ 未检测到回复，可能是 AI 响应过慢或 DOM 结构已变更。'
  if (normalized === 'timeout') return '⚠️ 回复超时了，请尝试重新发送。'
  if (normalized === 'site_blocked') return '⚠️ 站点阻断，请检查登录状态或处理 Cookie 弹窗。'
  return `回复失败：${reason}`
}

export function isStructuredFailureReason(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return normalized === 'send_failed' || normalized === 'response_not_found' || normalized === 'timeout' || normalized === 'site_blocked'
}

export function messageFailureText(message: GroupMessage): string {
  return getDiagnosticText(message.content)
}
