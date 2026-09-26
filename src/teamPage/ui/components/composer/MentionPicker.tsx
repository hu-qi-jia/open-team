import type { GroupRole } from '../../../../group/types'
import { roleModelLabel, roleMentionLabelOptionsFromSettings } from '../../../../group/mentionParser'

export type MentionLabelOptions = ReturnType<typeof roleMentionLabelOptionsFromSettings>

type MentionOption =
  | { type: 'all' }
  | { type: 'role'; role: GroupRole }

export function createMentionOptions(roles: GroupRole[]): MentionOption[] {
  return [{ type: 'all' }, ...roles.map(role => ({ type: 'role' as const, role }))]
}

interface MentionPickerProps {
  options: MentionOption[]
  activeIndex: number
  labelOptions: MentionLabelOptions
  roleToneClass(seed: string | undefined): string
  roleAvatarLabel(name: string | undefined): string
  onSelectOption(option: MentionOption): void
}

/*
 * @ 提及选择面板（原 renderMentionPanel 对译）。键盘交互（↑↓ 循环、
 * Enter 确认、Escape 隐藏）由宿主 textarea 的 keydown 驱动——面板只是
 * 渲染选项与 active 高亮；不使用 cmdk Command：Command 需要独占输入框
 * 焦点，而这里是「textarea 光标处的复合补全」，焦点必须留在 textarea
 * （与 Slack/Discord 的 mention 面板同构）。
 */
export function MentionPicker({ options, activeIndex, labelOptions, roleToneClass, roleAvatarLabel, onSelectOption }: MentionPickerProps) {
  return (
    <div id="mention-panel" className="mention-panel">
      {options.map((option, index) => {
        const className = index === activeIndex ? 'mention-option active' : 'mention-option'
        if (option.type === 'all') {
          return (
            <button key="all" type="button" className={className} onPointerDown={event => event.preventDefault()} onClick={() => onSelectOption(option)}>
              <span className="mention-avatar mention-avatar-all">全</span>
              <span className="mention-name">所有人</span>
              <span className="mention-site-badge">全员</span>
            </button>
          )
        }
        const role = option.role
        return (
          <button key={role.id} type="button" className={className} onPointerDown={event => event.preventDefault()} onClick={() => onSelectOption(option)}>
            <span className={`mention-avatar ${roleToneClass(role.name)}`}>{roleAvatarLabel(role.name)}</span>
            <span className="mention-name">{role.name}</span>
            <span className={`mention-site-badge ${role.modelSource === 'external' ? 'site-pill-external' : `site-pill-${role.chatSite ?? 'gemini'}`}`}>
              {roleModelLabel(role, labelOptions)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export type { MentionOption }
