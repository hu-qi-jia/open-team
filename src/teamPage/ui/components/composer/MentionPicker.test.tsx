// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import { roleMentionLabelOptionsFromSettings } from '../../../../group/mentionParser'
import type { GroupRole } from '../../../../group/types'
import { roleAvatarLabel, roleToneClass } from '../../../viewHelpers'
import { MentionPicker, createMentionOptions } from './MentionPicker'

/*
 * @ 提及面板的视觉契约（S2 Task 6 换 popover 视觉时建立）。行为契约
 * （键盘循环、onPointerDown 保焦点、Escape 隐藏）由 Composer.test.tsx
 * 以宿主集成方式覆盖，这里只钉类名钩子与 utilities：
 * - 面板锚在 Composer 的 relative 表单上（bottom-full + z-20），
 *   rounded 裁切与内部滚动分离（overflow-hidden + 内层 max-h-52）；
 * - `.mention-option` / `.mention-option.active` 是键盘高亮钩子，
 *   被宿主用例与 E2E 依赖，必须保留；
 * - legacy.css 的 .mention-panel 族已退役（剥注释后不得复现）。
 */

function makeRole(id: string, name: string): GroupRole {
  return {
    id,
    chatId: 'chat-1',
    name,
    systemPrompt: `从${name}角度分析`,
    status: 'ready',
    contextCursor: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

function renderPanel(activeIndex = 0) {
  const roles = [makeRole('role-1', '工程师'), makeRole('role-2', '产品经理')]
  const labelOptions = roleMentionLabelOptionsFromSettings(createDefaultStore().settings)
  return render(
    <MentionPicker
      options={createMentionOptions(roles)}
      activeIndex={activeIndex}
      labelOptions={labelOptions}
      roleToneClass={roleToneClass}
      roleAvatarLabel={roleAvatarLabel}
      onSelectOption={vi.fn()}
    />,
  )
}

describe('team page mention picker visual', () => {
  it('renders the panel as an anchored popover with a separate scroll list', () => {
    const { container } = renderPanel()

    const panel = container.querySelector('#mention-panel')
    expect(panel).not.toBeNull()
    expect(panel!.className).toContain('mention-panel')
    // 定位锚：Composer 表单为 containing block，面板浮在其上方并压过 textarea
    expect(panel!.className).toContain('absolute bottom-full left-0 right-0 z-20 mb-2')
    // 容器管 rounded 裁切，内层管滚动（shadcn Command/CommandList 同构）
    expect(panel!.className).toContain('overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md')
    const list = panel!.firstElementChild
    expect(list!.className).toBe('max-h-52 overflow-y-auto')
  })

  it('keeps the mention-option family with the active keyboard-nav hook', () => {
    const { container } = renderPanel(1)

    const options = [...container.querySelectorAll('button.mention-option')]
    expect(options.map(option => option.className.startsWith('mention-option'))).toEqual([true, true, true])

    const active = container.querySelector('button.mention-option.active')
    expect(active!.textContent).toContain('工程师')
    expect(active!.className).toBe('mention-option active flex w-full items-center gap-2 rounded-sm bg-accent px-2 py-1.5 text-sm text-accent-foreground outline-none cursor-pointer')

    const inactive = options.filter(option => !option.className.includes(' active'))
    expect(inactive).toHaveLength(2)
    for (const option of inactive) {
      expect(option.className).toBe('mention-option flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground cursor-pointer')
    }
  })

  it('renders avatar chip, name, and site badge with SiteBadge utilities', () => {
    const { container } = renderPanel()

    const avatar = container.querySelector('.mention-avatar')!
    // S7/T3：border/overflow/字重/行高/white/shrink 承接退役的 legacy
    // .mention-avatar 独占声明（utilities 化），断言同步
    expect(avatar.className).toContain('flex size-6 shrink-0 items-center justify-center overflow-hidden whitespace-nowrap rounded-full border border-white/20 bg-muted text-xs font-[780] leading-none text-white')
    expect(avatar.className).toContain('mention-avatar-all')

    const roleAvatar = [...container.querySelectorAll('.mention-avatar')][1]!
    expect(roleAvatar.className).toContain('role-tone-')

    for (const name of container.querySelectorAll('.mention-name')) {
      expect(name.className).toBe('mention-name flex-1 truncate text-left')
    }

    const badge = container.querySelector('.mention-site-badge')!
    expect(badge.className).toContain('rounded-sm bg-none bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground')
    const roleBadge = [...container.querySelectorAll('.mention-site-badge')][1]!
    expect(roleBadge.className).toMatch(/site-pill-(external|gemini|chatgpt|claude|deepseek|grok)/)
  })

  it('keeps the no-cmdk rationale and retires the mention panel family from legacy.css', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/components/composer/MentionPicker.tsx'), 'utf8')
    // 焦点必须留在宿主 textarea——该约束由组件头注释钉住
    expect(source).toContain('cmdk')

    const css = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/styles/legacy.css'), 'utf8')
    const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(cssWithoutComments).not.toContain('.mention-panel')
    expect(cssWithoutComments).not.toContain('.mention-option')
    expect(cssWithoutComments).not.toContain('.mention-name')
    expect(cssWithoutComments).not.toContain('.mention-site-badge')
  })
})
