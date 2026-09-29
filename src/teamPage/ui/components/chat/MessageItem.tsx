import { memo, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Copy, Download, Quote, RotateCcw, Square } from 'lucide-react'
import type { GroupMessage, GroupRole, MessageHighlight, MessageReference, OrchestrationReviewResult } from '../../../../group/types'
import { roleMentionLabel, roleModelLabel, type RoleMentionLabelOptions } from '../../../../group/mentionParser'
import { messageTitle, roleAvatarLabel, roleToneClass } from '../../../viewHelpers'
import { showError, showSuccess } from '../../lib/toast'
import { useServices } from '../../context/ServicesContext'
import { getAppState } from '../../lib/appStore'
import { renderMarkdownMessageHtml } from '../../lib/markdown'
import { applyHighlightsToBody } from '../../lib/messageHighlightsDom'
import { isStructuredFailureReason, messageFailureText, shouldRenderMarkdownMessage } from '../../lib/messageSignature'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Spinner } from '../ui/spinner'
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
      <article className="message-row message system my-2 flex justify-center" data-message-id={message.id}>
        <div className="message-system-pill w-fit rounded-full bg-muted/70 px-3 py-1 text-center text-xs text-muted-foreground">
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
      className={`message-row message ${message.type}${showName ? '' : ' compact'}${showAvatar ? '' : ' no-avatar'} group flex py-1.5 ${message.type === 'user' ? ' flex-row-reverse' : ''}`}
      data-message-id={message.id}
    >
      <div className="message-inner flex w-full min-w-0 items-start gap-3">
        <Avatar
          className={`message-avatar size-7 shrink-0 cursor-pointer select-none ${role ? ' mention-shortcut hover:brightness-[1.08]' : ''}`}
          hidden={!showAvatar}
          title={mentionTitle}
          onClick={onMentionShortcut}
          onContextMenu={onMentionContextMenu}
        >
          <AvatarFallback className={`${message.type === 'user' ? 'role-tone-5' : roleToneClass(message.roleName)} text-xs font-medium text-secondary-foreground`}>
            {message.type === 'user' ? '你' : roleAvatarLabel(message.roleName)}
          </AvatarFallback>
        </Avatar>

        <div className={`message-stack flex min-w-0 flex-col gap-1 ${message.type === 'user' ? 'items-end' : 'items-start flex-1'}`}>
          {isAssistant && showName && (
            <div
              className={`message-name${role ? ' mention-shortcut cursor-pointer hover:brightness-[1.08]' : ''} flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs font-medium text-muted-foreground`}
              title={mentionTitle}
              onClick={onMentionShortcut}
              onContextMenu={onMentionContextMenu}
            >
              {/* S7/T5：原 .message-name-text 的 min-width:0 / overflow /
                  text-overflow 三件套由 min-w-0 + truncate 承担（父级已有
                  whitespace-nowrap）。类名保留作钩子。 */}
              <span className="message-name-text min-w-0 truncate">{messageTitle(message)}</span>
              {role && <SiteBadge role={role} mentionLabelOptions={mentionLabelOptions} />}
              {role && <SiteJumpButton chatId={message.chatId} role={role} />}
            </div>
          )}

          <div className={`message-bubble min-w-0 max-w-full ${message.type === 'user' ? 'rounded-lg bg-primary px-3 py-2 text-primary-foreground' : 'rounded-lg bg-muted px-3 py-2 text-sm'}`}>
            <OrchestrationMessageLabel message={message} />
            {hasVisibleTextBody && (emptyPendingBody ? (
              <div className="message-body flex items-center gap-2 text-sm leading-relaxed text-muted-foreground">
                <Spinner className="size-3.5" />
                <span>正在回复中…</span>
              </div>
            ) : (
              <div
                ref={bodyRef}
                className={`message-body text-sm leading-relaxed break-words ${bodyHtml !== undefined ? ' markdown-body' : ' whitespace-pre-wrap'}`}
              >
                {message.type === 'user' && (message.mentionsAll || mentionedRoles.length > 0) && (
                  <div className="message-mentions mb-0.5 mr-1.5 inline-flex flex-wrap gap-1.5">
                    {message.mentionsAll && <span className="message-mention mr-1 inline-block rounded-md bg-primary-foreground/15 px-1.5 py-0.5 text-xs font-medium text-primary-foreground">@所有人</span>}
                    {mentionedRoles.map(mentionRole => (
                      <span key={mentionRole.id} className="message-mention mr-1 inline-block rounded-md bg-primary-foreground/15 px-1.5 py-0.5 text-xs font-medium text-primary-foreground">@{roleMentionLabel(mentionRole, mentionLabelOptions)}</span>
                    ))}
                  </div>
                )}
                {structuredFailure
                  ? messageFailureText(message)
                  : bodyHtml !== undefined
                    ? <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
                    : message.content}
              </div>
            ))}
            <ImageGrid message={message} />
            {reviewResult && <ReviewSummary result={reviewResult} />}
            {message.references?.length ? <ReferenceBox reference={message.references[0]} /> : null}

            {/* S7/T5：原 .message-tools 未被 utilities 覆盖的活声明只有
                justify-content:flex-start 与 padding 0 8px 7px（display/gap/
                margin-top 已被下面那行的 flex/gap-0.5/mt-1 压死）。 */}
            {isAssistant && (
              <div className="message-tools mt-1 flex items-center justify-start gap-0.5 px-2 pb-[7px] opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
    <span className={`role-site-badge ${role.modelSource === 'external' ? 'site-pill-external' : `site-pill-${role.chatSite ?? 'gemini'}`} rounded-sm bg-none bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground`}>{roleModelLabel(role, mentionLabelOptions)}</span>
  )
}

export function SiteJumpButton({ chatId, role }: { chatId: string; role: GroupRole }) {
  const services = useServices()
  if (role.modelSource === 'external') return undefined
  return (
    <MessageToolButton
      label="跳转到原始窗口"
      icon="jump"
      className="message-site-jump-btn opacity-[0.72]!"
      onClick={() => services.messageActions.focusRoleFrame(chatId, role.id)}
    />
  )
}

function OrchestrationMessageLabel({ message }: { message: GroupMessage }) {
  if (!message.orchestrationKind) return undefined
  const parts = ['编排']
  if (message.orchestrationStageIndex !== undefined) parts.push(`第 ${message.orchestrationStageIndex + 1} 步`)
  parts.push(orchestrationKindLabel(message.orchestrationKind))
  return <div className={`orchestration-message-label orchestration-message-${message.orchestrationKind} mb-1 w-fit rounded-sm bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground`}>{parts.join(' · ')}</div>
}

function orchestrationKindLabel(kind: NonNullable<GroupMessage['orchestrationKind']>): string {
  if (kind === 'task') return '任务'
  if (kind === 'role') return '人员'
  if (kind === 'review') return '复核'
  return '状态'
}

function ReviewSummary({ result }: { result: OrchestrationReviewResult }) {
  return (
    /*
     * S7/T5：原 .orchestration-review-summary 全量 utilities 化（浅色默认 +
     * dark: 覆盖）。逐属性对照：
     *   display grid / gap 4px / margin 0 10px 10px / radius 6px /
     *   padding 7px 8px / font-size 12px / line-height 1.45；
     *   暗色描边 rgba(161,161,170,.18) 与底 rgba(255,255,255,.06)，
     *   浅色覆盖为 rgba(113,113,122,.16) 与纯白；
     *   暗色 color:currentColor 是 no-op（等于继承），对译为 dark:text-inherit，
     *   浅色 color:var(--muted-foreground) 作默认值。
     */
    <div className="orchestration-review-summary mx-2.5 mb-2.5 grid gap-1 rounded-md border border-zinc-500/16 bg-white px-2 py-[7px] text-[12px] leading-[1.45] text-muted-foreground dark:border-zinc-400/[0.18] dark:bg-white/[0.06] dark:text-inherit">
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
      {/* S7/T5：原 `.orchestration-review-line span:first-child` 的字重 760
          与双主题标签色（暗 rgba(243,245,246,.62) / 浅 rgba(63,63,70,.68)）。 */}
      <span className="font-[760] text-zinc-700/[0.68] dark:text-[rgba(243,245,246,0.62)]">{label}：</span>
      <span>{value}</span>
    </div>
  )
}

function ReferenceBox({ reference }: { reference: MessageReference }) {
  /*
   * S7/T5：原 .reference-box 只剩四件活声明——display:-webkit-box /
   * overflow:hidden / -webkit-line-clamp:2 / -webkit-box-orient:vertical
   * （合起来就是 Tailwind 的 line-clamp-2）与 opacity:.68；
   * margin 0 10px 10px 里 margin-top 被 mt-2 压死，另两侧由 mx/mb 承担。
   * border:0 / radius 6px / padding / background / color / font-size /
   * line-height 全被本行 utilities 与 text-xs 压死，不迁。
   */
  return (
    <div className="reference-box mt-2 mx-2.5 mb-2.5 line-clamp-2 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground opacity-[0.68]">
      {`引用 ${reference.roleName || '人员'}：${truncate(reference.contentSnapshot, 160)}`}
    </div>
  )
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}

type MessageActionIcon = 'copy' | 'quote' | 'jump' | 'check' | 'stop' | 'retry' | 'download'

const CopyIcon = Copy
const QuoteIcon = Quote
const CheckIcon = Check
const SquareIcon = Square
const RotateCcwIcon = RotateCcw
const DownloadIcon = Download
const ArrowUpRightIcon = ArrowUpRight

/*
 * 消息工具按钮（原 createMessageIconButton 对译）：stop 按钮 pointerdown
 * 即触发（流式中无需精确点击），其余走 click；pointerdown 激活后吞掉
 * 紧随的 click，避免双重触发。V3 起 icon 用 lucide 线性图标。
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
  const Icon = messageActionIcon(icon)
  return (
    <button
      type="button"
      className={`message-tool-btn relative flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground hover:opacity-[0.96] focus-visible:opacity-[0.96] disabled:opacity-50 ${className !== undefined ? ` ${className}` : ''}${className === 'copied' ? ' text-chart-2 opacity-100' : ' opacity-[0.58]'}`}
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
      {/* S7/T3：fill-current 承接原 legacy .message-tool-btn svg 的
        * fill:currentColor（lucide 的 fill="none" attribute 被 CSS 覆盖的现状）； */
      }
      <Icon className="size-3.5 fill-current" aria-hidden="true" />
    </button>
  )
}

function messageActionIcon(icon: MessageActionIcon): React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }> {
  if (icon === 'copy') return CopyIcon
  if (icon === 'quote') return QuoteIcon
  if (icon === 'check') return CheckIcon
  if (icon === 'stop') return SquareIcon
  if (icon === 'retry') return RotateCcwIcon
  if (icon === 'download') return DownloadIcon
  return ArrowUpRightIcon
}
