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
 * S2 Task 6：面板换 popover 视觉——定位锚在 Composer 的 relative 表单
 * （bottom-full mb-2，z-20 压过 textarea），rounded 裁切交给面板的
 * overflow-hidden，内部滚动列表由 max-h-52 overflow-y-auto 的内层承担
 * （shadcn Command/CommandList 同构）；.mention-panel / .mention-option
 * 等 legacy 规则已退役，类名保留作选择器钩子。
 */
export function MentionPicker({ options, activeIndex, labelOptions, roleToneClass, roleAvatarLabel, onSelectOption }: MentionPickerProps) {
  return (
    <div
      id="mention-panel"
      className="mention-panel absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
    >
      <div className="max-h-52 overflow-y-auto">
        {options.map((option, index) => {
          const className = index === activeIndex
            ? 'mention-option active flex w-full items-center gap-2 rounded-sm bg-accent px-2 py-1.5 text-sm text-accent-foreground outline-none cursor-pointer'
            : 'mention-option flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground cursor-pointer'
          if (option.type === 'all') {
            return (
              <button key="all" type="button" className={className} onPointerDown={event => event.preventDefault()} onClick={() => onSelectOption(option)}>
                <span className="mention-avatar mention-avatar-all flex size-6 items-center justify-center rounded-full bg-muted text-xs">全</span>
                <span className="mention-name flex-1 truncate text-left">所有人</span>
                <span className="mention-site-badge rounded-sm bg-none bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">全员</span>
              </button>
            )
          }
          const role = option.role
          return (
            <button key={role.id} type="button" className={className} onPointerDown={event => event.preventDefault()} onClick={() => onSelectOption(option)}>
              <span className={`mention-avatar ${roleToneClass(role.name)} flex size-6 items-center justify-center rounded-full bg-muted text-xs`}>{roleAvatarLabel(role.name)}</span>
              <span className="mention-name flex-1 truncate text-left">{role.name}</span>
              <span className={`mention-site-badge rounded-sm bg-none bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground ${role.modelSource === 'external' ? 'site-pill-external' : `site-pill-${role.chatSite ?? 'gemini'}`}`}>
                {roleModelLabel(role, labelOptions)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export type { MentionOption }
