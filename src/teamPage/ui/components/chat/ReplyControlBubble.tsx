import type { GroupRole } from '../../../../group/types'
import { roleMentionLabel, type RoleMentionLabelOptions } from '../../../../group/mentionParser'
import { roleAvatarLabel, roleToneClass } from '../../../viewHelpers'
import { showError } from '../../lib/toast'
import { useServices } from '../../context/ServicesContext'
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
      className={`message-row message assistant ${stopped ? 'stopped' : 'thinking'}${showName ? '' : ' compact'}${showAvatar ? '' : ' no-avatar'} group flex px-6 py-1.5`}
    >
      <div className="message-inner flex w-full min-w-0 items-start gap-3">
        <div
          className={`message-avatar ${roleToneClass(role.name)}${showAvatar ? ' mention-shortcut' : ''} flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-none bg-secondary shadow-none text-xs font-medium text-secondary-foreground select-none`}
          hidden={!showAvatar}
          title={mentionTitle}
          onClick={onMentionShortcut}
          onContextMenu={onMentionContextMenu}
        >{roleAvatarLabel(role.name)}</div>

        <div className="message-stack flex min-w-0 flex-1 flex-col items-start gap-1">
          {showName && (
            <div
              className="message-name mention-shortcut flex cursor-pointer items-center gap-1.5 text-[13px] font-medium text-muted-foreground"
              title={mentionTitle}
              onClick={onMentionShortcut}
              onContextMenu={onMentionContextMenu}
            >
              <span className="message-name-text">{role.name}</span>
              <SiteBadge role={role} mentionLabelOptions={mentionLabelOptions} />
              <SiteJumpButton chatId={role.chatId} role={role} />
            </div>
          )}

          <div className="message-bubble min-w-0 max-w-full bg-transparent text-foreground shadow-none before:hidden">
            <div className={`message-body text-sm leading-relaxed${stopped ? '' : ' thinking-dots'}`}>{stopped ? '已停止回复' : '正在回复中 '}</div>
            <div className="message-tools mt-1 flex items-center gap-0.5">
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
    </article>
  )
}
