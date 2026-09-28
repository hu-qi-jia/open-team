import type { GroupRole } from '../../../../group/types'
import { roleMentionLabel, type RoleMentionLabelOptions } from '../../../../group/mentionParser'
import { roleAvatarLabel, roleToneClass } from '../../../viewHelpers'
import { showError } from '../../lib/toast'
import { useServices } from '../../context/ServicesContext'
import { Avatar, AvatarFallback } from '../ui/avatar'
import { Spinner } from '../ui/spinner'
import { MessageToolButton, SiteBadge, SiteJumpButton } from './MessageItem'

export interface ReplyControlBubbleProps {
  role: GroupRole
  showName?: boolean
  showAvatar?: boolean
  mentionLabelOptions: RoleMentionLabelOptions
}

/*
 * thinking / 停止回复占位气泡（原 replyControlBubble 对译）：
 * 群里有角色处于 thinking（且未在流式输出）或 stopped（有未答的最后提问）
 * 时，出现在消息流末尾，提供「停止回复 / 重新发送」控制。
 * 数据来自 role 本身，无需 memo 签名——父级按角色 id + 状态直接渲染。
 */
export function ReplyControlBubble({ role, showName = true, showAvatar = true, mentionLabelOptions }: ReplyControlBubbleProps) {
  const services = useServices()
  const stopped = role.status === 'stopped'

  const mentionTitle = `@${roleMentionLabel(role, mentionLabelOptions)}`
  const onMentionShortcut = (event: React.MouseEvent) => {
    event.stopPropagation()
    services.messageActions.insertMention(role)
  }
  const onMentionContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    services.messageActions.insertMention(role)
  }

  return (
    <article
      className={`message-row message assistant ${stopped ? 'stopped' : 'thinking'}${showName ? '' : ' compact'}${showAvatar ? '' : ' no-avatar'} group flex py-1.5`}
    >
      <div className="message-inner flex w-full min-w-0 items-start gap-3">
        <Avatar
          className={`message-avatar size-7 shrink-0 cursor-pointer select-none ${showAvatar ? ' mention-shortcut' : ''}`}
          hidden={!showAvatar}
          title={mentionTitle}
          onClick={onMentionShortcut}
          onContextMenu={onMentionContextMenu}
        >
          <AvatarFallback className={`${roleToneClass(role.name)} text-xs font-medium text-secondary-foreground`}>
            {roleAvatarLabel(role.name)}
          </AvatarFallback>
        </Avatar>

        <div className="message-stack flex min-w-0 flex-1 flex-col items-start gap-1">
          {showName && (
            <div
              className="message-name mention-shortcut flex min-w-0 cursor-pointer items-center gap-1.5 overflow-hidden whitespace-nowrap text-xs font-medium text-muted-foreground"
              title={mentionTitle}
              onClick={onMentionShortcut}
              onContextMenu={onMentionContextMenu}
            >
              <span className="message-name-text">{role.name}</span>
              <SiteBadge role={role} mentionLabelOptions={mentionLabelOptions} />
              <SiteJumpButton chatId={role.chatId} role={role} />
            </div>
          )}

          {/* 状态行：左文（Spinner + 名称文案）右钮（停止/重发），规格 §4.4 */}
          <div className="message-bubble min-w-0 max-w-full rounded-lg bg-muted px-3 py-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="message-body flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                {!stopped && <Spinner className="size-3.5" />}
                <span>{stopped ? '已停止回复' : `${role.name} 正在回复…`}</span>
              </div>
              <div className="flex shrink-0 items-center">
                {stopped ? (
                  <MessageToolButton
                    label="重新发送"
                    icon="retry"
                    onClick={() => services.messageActions.retryRoleReply(role).catch(error => showError(error instanceof Error ? error.message : String(error)))}
                  />
                ) : (
                  <MessageToolButton
                    label="停止回复"
                    icon="stop"
                    activateOnPointerDown
                    onClick={() => services.messageActions.stopRoleReply(role).catch(error => showError(error instanceof Error ? error.message : String(error)))}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
