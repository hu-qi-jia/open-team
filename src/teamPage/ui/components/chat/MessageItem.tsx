import { memo, useEffect, useRef, useState } from 'react'
import type { GroupMessage, GroupRole, MessageHighlight, MessageReference, OrchestrationReviewResult } from '../../../../group/types'
import { roleMentionLabel, roleModelLabel, type RoleMentionLabelOptions } from '../../../../group/mentionParser'
import { messageTitle, roleAvatarLabel, roleToneClass } from '../../../viewHelpers'
import { showError, showSuccess } from '../../lib/toast'
import { useServices } from '../../context/ServicesContext'
import { getAppState } from '../../lib/appStore'
import { renderMarkdownMessageHtml } from '../../lib/markdown'
import { applyHighlightsToBody } from '../../lib/messageHighlightsDom'
import { isStructuredFailureReason, messageFailureText, shouldRenderMarkdownMessage } from '../../lib/messageSignature'
import { ImageGrid } from './ImageGrid'

const COPY_FEEDBACK_MS = 1200

export interface MessageItemProps {
  message: GroupMessage
  showName: boolean
  showAvatar: boolean
  /** roleForMessage 解析结果（rolesById[roleId] 且 chatId 匹配） */
  role: GroupRole | undefined
  reviewResult: OrchestrationReviewResult | undefined
  highlights: MessageHighlight[] | undefined
  /** computeMessageSignature 的结果，memo 比较键 */
  signature: string
  /** mentionedRoleIds 解析出的角色（@ 徽标文案） */
  mentionedRoles: GroupRole[]
  /** 由父级按 Messages 渲染时点解析；签名不变时标签随之冻结，与原节点缓存一致 */
  mentionLabelOptions: RoleMentionLabelOptions
}

/*
 * 单条消息气泡（原 renderMessageNode 整体对译）。
 * memo 以签名为唯一比较键：签名不变 → 整棵子树跳过协调，等价替代原
 * messageNodeCache 的节点复用；流式期间只有内容变化的气泡重渲。
 * 组件不订阅 store（settings 等经 props 传入）——每次推送都是新 store
 * 对象，组件内订阅会打穿 memo。services 只在事件/effect 期访问。
 */
export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  const { message, showName, showAvatar, role, reviewResult, highlights, mentionedRoles, mentionLabelOptions } = props
  const services = useServices()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const isAssistant = message.type === 'assistant'
  const isPendingAssistant = isAssistant && message.status === 'pending'
  const useMarkdown = shouldRenderMarkdownMessage(message)
  const emptyPendingBody = isPendingAssistant && !message.content.trim()
  const structuredFailure = isAssistant && message.status === 'error' && isStructuredFailureReason(message.content)
  const bodyHtml = useMarkdown && !emptyPendingBody && !structuredFailure
    ? renderMarkdownMessageHtml(message.content)
    : undefined

  // markdown 链接安全属性 + 高亮回显：签名变化（innerHTML 被替换）后重放
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    for (const link of body.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      link.target = '_blank'
      link.rel = 'noreferrer'
    }
    if (highlights?.length) applyHighlightsToBody(body, highlights)
  }, [props.signature])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (message.type === 'system') {
    return (
      <article className="message-row message system" data-message-id={message.id}>
        <div className="message-system-pill">
          <OrchestrationMessageLabel message={message} />
          {message.content}
        </div>
      </article>
    )
  }

  const mentionTitle = role ? `@${roleMentionLabel(role, mentionLabelOptions)}` : undefined
  const onMentionShortcut = role
    ? (event: React.MouseEvent) => {
        event.stopPropagation()
        services.messageActions.insertMention(role)
      }
    : undefined
  const onMentionContextMenu = role
    ? (event: React.MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
        services.messageActions.insertMention(role)
      }
    : undefined

  const hasVisibleTextBody = message.status === 'pending' || Boolean(message.content.trim())

  return (
    <article
      className={`message-row message ${message.type}${showName ? '' : ' compact'}${showAvatar ? '' : ' no-avatar'}`}
      data-message-id={message.id}
    >
      <div className="message-inner">
        <div
          className={`message-avatar ${message.type === 'user' ? 'role-tone-5' : roleToneClass(message.roleName)}${role ? ' mention-shortcut' : ''}`}
          hidden={!showAvatar}
          title={mentionTitle}
          onClick={onMentionShortcut}
          onContextMenu={onMentionContextMenu}
        >{message.type === 'user' ? '你' : roleAvatarLabel(message.roleName)}</div>

        <div className="message-stack">
          {isAssistant && showName && (
            <div
              className={`message-name${role ? ' mention-shortcut' : ''}`}
              title={mentionTitle}
              onClick={onMentionShortcut}
              onContextMenu={onMentionContextMenu}
            >
              <span className="message-name-text">{messageTitle(message)}</span>
              {role && <SiteBadge role={role} mentionLabelOptions={mentionLabelOptions} />}
              {role && <SiteJumpButton chatId={message.chatId} role={role} />}
            </div>
          )}

          <div className="message-bubble">
            <OrchestrationMessageLabel message={message} />
            {hasVisibleTextBody && (
              <div
                ref={bodyRef}
                className={`message-body${isPendingAssistant ? ' thinking-dots' : ''}${bodyHtml !== undefined ? ' markdown-body' : ''}`}
              >
                {message.type === 'user' && (message.mentionsAll || mentionedRoles.length > 0) && (
                  <div className="message-mentions">
                    {message.mentionsAll && <span className="message-mention">@所有人</span>}
                    {mentionedRoles.map(mentionRole => (
                      <span key={mentionRole.id} className="message-mention">@{roleMentionLabel(mentionRole, mentionLabelOptions)}</span>
                    ))}
                  </div>
                )}
                {emptyPendingBody
                  ? '正在回复中 '
                  : structuredFailure
                    ? messageFailureText(message)
                    : bodyHtml !== undefined
                      ? <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                      : message.content}
              </div>
            )}
            <ImageGrid message={message} />
            {reviewResult && <ReviewSummary result={reviewResult} />}
            {message.references?.length ? <ReferenceBox reference={message.references[0]} /> : null}

            {isAssistant && (
              <div className="message-tools">
                {message.roleId && message.status === 'pending' && role ? (
                  <MessageToolButton
                    label="停止回复"
                    icon="stop"
                    activateOnPointerDown
                    onClick={() => services.messageActions.stopRoleReply(role).catch(error => showError(error instanceof Error ? error.message : String(error)))}
                  />
                ) : message.roleId && message.status === 'error' && role ? (
                  <MessageToolButton
                    label="重新回复"
                    icon="retry"
                    onClick={() => services.messageActions.retryRoleReply(role, message.id).catch(error => showError(error instanceof Error ? error.message : String(error)))}
                  />
                ) : message.roleId && role?.modelSource === 'external' ? (
                  <MessageToolButton
                    label="重新回复"
                    icon="retry"
                    onClick={() => services.messageActions.retryRoleReply(role, message.id).catch(error => showError(error instanceof Error ? error.message : String(error)))}
                  />
                ) : message.roleId ? (
                  <>
                    <MessageToolButton label="跳转到原始窗口" icon="jump" onClick={() => services.messageActions.focusRoleFrame(message.chatId, message.roleId!)} />
                    <MessageToolButton label="重新同步完整回复" icon="retry" onClick={() => handleResyncMessage(services, message)} />
                  </>
                ) : null}
                {Boolean(message.content.trim()) && (
                  <>
                    <MessageToolButton label="引用回复" icon="quote" onClick={() => services.messageActions.setReference(message)} />
                    <MessageToolButton
                      label={copied ? '已复制' : '复制回复'}
                      icon={copied ? 'check' : 'copy'}
                      className={copied ? 'copied' : undefined}
                      onClick={() => {
                        copyMessageContent(message)
                          .then(() => setCopied(true))
                          .catch(error => showError(error instanceof Error ? error.message : String(error)))
                      }}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}, (previous, next) => previous.signature === next.signature)

async function copyMessageContent(message: GroupMessage): Promise<void> {
  if (!navigator.clipboard?.writeText) throw new Error('当前浏览器不支持复制')
  await navigator.clipboard.writeText(message.content)
}

export function handleResyncMessage(services: ReturnType<typeof useServices>, message: GroupMessage): void {
  services.log.warn('ui:message-resync:click', {
    chatId: message.chatId,
    roleId: message.roleId,
    messageId: message.id,
    contentLength: message.content.length,
  })
  if (!message.roleId) {
    services.log.warn('ui:message-resync:missing-role', { chatId: message.chatId, messageId: message.id })
    return
  }
  const state = getAppState()
  state.preserveNextMessageScroll = true
  services.messageActions.resyncMessageReply(message)
    .then(() => {
      showSuccess('执行成功了')
    })
    .catch(error => {
      services.log.warn('ui:message-resync:failed', {
        chatId: message.chatId,
        roleId: message.roleId,
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      })
      showError(error instanceof Error ? error.message : String(error))
    })
    .finally(() => {
      state.preserveNextMessageScroll = false
    })
}

/** 站点徽标（原 siteBadge 对译）；ReplyControlBubble 复用 */
export function SiteBadge({ role, mentionLabelOptions }: { role: GroupRole; mentionLabelOptions: RoleMentionLabelOptions }) {
  return (
    <span className={`role-site-badge ${role.modelSource === 'external' ? 'site-pill-external' : `site-pill-${role.chatSite ?? 'gemini'}`}`}>{roleModelLabel(role, mentionLabelOptions)}</span>
  )
}

export function SiteJumpButton({ chatId, role }: { chatId: string; role: GroupRole }) {
  const services = useServices()
  if (role.modelSource === 'external') return undefined
  return (
    <MessageToolButton
      label="跳转到原始窗口"
      icon="jump"
      className="message-site-jump-btn"
      onClick={() => services.messageActions.focusRoleFrame(chatId, role.id)}
    />
  )
}

function OrchestrationMessageLabel({ message }: { message: GroupMessage }) {
  if (!message.orchestrationKind) return undefined
  const parts = ['编排']
  if (message.orchestrationStageIndex !== undefined) parts.push(`第 ${message.orchestrationStageIndex + 1} 步`)
  parts.push(orchestrationKindLabel(message.orchestrationKind))
  return <div className={`orchestration-message-label orchestration-message-${message.orchestrationKind}`}>{parts.join(' · ')}</div>
}

function orchestrationKindLabel(kind: NonNullable<GroupMessage['orchestrationKind']>): string {
  if (kind === 'task') return '任务'
  if (kind === 'role') return '人员'
  if (kind === 'review') return '复核'
  return '状态'
}

function ReviewSummary({ result }: { result: OrchestrationReviewResult }) {
  return (
    <div className="orchestration-review-summary">
      <ReviewLine label="决策" value={result.decision === 'pass' ? '通过' : '不通过'} />
      {result.reason && <ReviewLine label="原因" value={result.reason} />}
      {result.failedCriteria.length > 0 && <ReviewLine label="未通过" value={result.failedCriteria.join('、')} />}
      {result.nextRoundInstruction && <ReviewLine label="重试说明" value={result.nextRoundInstruction} />}
    </div>
  )
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="orchestration-review-line">
      <span>{label}：</span>
      <span>{value}</span>
    </div>
  )
}

function ReferenceBox({ reference }: { reference: MessageReference }) {
  return (
    <div className="reference-box">
      {`引用 ${reference.roleName || '人员'}：${truncate(reference.contentSnapshot, 160)}`}
    </div>
  )
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

type MessageActionIcon = 'copy' | 'quote' | 'jump' | 'check' | 'stop' | 'retry' | 'download'

/*
 * 消息工具按钮（原 createMessageIconButton 对译）：stop 按钮 pointerdown
 * 即触发（流式中无需精确点击），其余走 click；pointerdown 激活后吞掉
 * 紧随的 click，避免双重触发。
 */
export function MessageToolButton({ label, icon, onClick, activateOnPointerDown = false, className, disabled = false }: {
  label: string
  icon: MessageActionIcon
  onClick: () => void
  activateOnPointerDown?: boolean
  className?: string
  disabled?: boolean
}) {
  const activatedOnPointerDownRef = useRef(false)
  return (
    <button
      type="button"
      className={className !== undefined ? `message-tool-btn ${className}` : 'message-tool-btn'}
      disabled={disabled}
      aria-label={label}
      onPointerDown={event => {
        if (!activateOnPointerDown) return
        if (typeof PointerEvent !== 'undefined' && event instanceof PointerEvent && event.button !== 0) return
        event.preventDefault()
        event.stopPropagation()
        activatedOnPointerDownRef.current = true
        onClick()
      }}
      onClick={event => {
        event.stopPropagation()
        if (activatedOnPointerDownRef.current) {
          activatedOnPointerDownRef.current = false
          return
        }
        onClick()
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={messageActionIconPath(icon)} />
      </svg>
    </button>
  )
}

function messageActionIconPath(icon: MessageActionIcon): string {
  if (icon === 'copy') return 'M8 7.5A2.5 2.5 0 0 1 10.5 5h6A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 16h-6A2.5 2.5 0 0 1 8 13.5v-6Zm-3 3A2.5 2.5 0 0 1 7.5 8H8v5.5a2.5 2.5 0 0 0 2.5 2.5H16v.5a2.5 2.5 0 0 1-2.5 2.5h-6A2.5 2.5 0 0 1 5 16.5v-6Z'
  if (icon === 'quote') return 'M7.2 6.5c-1.7 1.4-2.7 3-2.7 5.1 0 1.9 1.1 3.2 2.8 3.2 1.3 0 2.3-.9 2.3-2.2 0-1.2-.8-2-2-2.1.2-1.1.9-2 2.1-3l-1.1-1.4c-.5.1-1 .2-1.4.4Zm8 0c-1.7 1.4-2.7 3-2.7 5.1 0 1.9 1.1 3.2 2.8 3.2 1.3 0 2.3-.9 2.3-2.2 0-1.2-.8-2-2-2.1.2-1.1.9-2 2.1-3l-1.1-1.4c-.5.1-1 .2-1.4.4Z'
  if (icon === 'check') return 'M9.2 16.4 4.8 12l1.4-1.4 3 3 8.6-8.6 1.4 1.4-10 10Z'
  if (icon === 'stop') return 'M7.5 6h9A1.5 1.5 0 0 1 18 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 16.5v-9A1.5 1.5 0 0 1 7.5 6Z'
  if (icon === 'retry') return 'M12 5a7 7 0 1 1-6.3 4H4a9 9 0 1 0 2.6-4.4L4 2v7h7L8.1 6.1A7 7 0 0 1 12 5Z'
  if (icon === 'download') return 'M11 4h2v8.2l2.6-2.6L17 11l-5 5-5-5 1.4-1.4 2.6 2.6V4Zm-5 13h12v2H6v-2Z'
  return 'M14 5h5v5h-1.6V7.7l-7.1 7.1-1.1-1.1 7.1-7.1H14V5ZM6.5 6h4v1.6h-4a.9.9 0 0 0-.9.9v9a.9.9 0 0 0 .9.9h9a.9.9 0 0 0 .9-.9v-4H18v4A2.5 2.5 0 0 1 15.5 20h-9A2.5 2.5 0 0 1 4 17.5v-9A2.5 2.5 0 0 1 6.5 6Z'
}
