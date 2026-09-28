// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, act, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import type { GroupChat, GroupRole } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import { notifyAppState } from '../../lib/appStore'
import { renderWithServices, type RenderWithServicesOptions } from '../../test/TestProviders'
import { Composer } from './Composer'

/*
 * 输入区 RTL（composerView.test.ts 重写）。目标预览 9 分支、@ 面板键序、
 * 引用条、发送清空/恢复语义与原实现逐条对应；发送走 services.runCommand
 * / reconnectRolesForSend 假实现，断言调用参数。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

import { showError } from '../../lib/toast'

describe('team page composer boundary', () => {
  it('keeps composer derivation in the lib layer and out of the entrypoint', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.tsx'), 'utf8')
    const previewSource = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/lib/composerPreview.ts'), 'utf8')

    expect(previewSource).toContain('export function deriveComposerPreview(')
    expect(previewSource).toContain('export function resolveMessageTargets(')
    expect(entrySource).not.toContain('function renderComposerState(')
    expect(entrySource).not.toContain('function submitComposerMessage(')
    expect(entrySource).not.toContain('createComposerView')
    // Composer 的命令式 API 经桥回填，messageActions 复用
    expect(entrySource).toContain('composerBridge')
  })

  it('removes the vanilla composer view module', () => {
    expect(existsSync(resolve(process.cwd(), 'src/teamPage/composerView.ts'))).toBe(false)
    expect(existsSync(resolve(process.cwd(), 'src/teamPage/composerView.test.ts'))).toBe(false)
  })
})

describe('team page composer mention panel', () => {
  it('offers an all-members mention option when the mention panel opens', async () => {
    const { composer } = renderComposer()

    await typeText(composer.input, '@')

    expect(composer.panel).not.toBeNull()
    expect(optionNames(composer.panel!)).toEqual(['所有人', '工程师'])
    expect(optionBadges(composer.panel!)).toEqual(['全员', 'DeepSeek'])

    fireEvent.click(composer.panel!.querySelector<HTMLButtonElement>('.mention-option')!)

    await waitFor(() => expect(inputValue(composer.input)).toBe('@所有人 '))

    await typeText(composer.input, '@所有人 请一起看')
    expect(targetPreviewText()).toBe('将发送给：工程师（DeepSeek）')
  })

  it('confirms the default all-members mention with Enter from the keyboard', async () => {
    const { composer, services } = renderComposer()

    await typeText(composer.input, '@')
    const event = pressKey(composer.input, 'Enter')

    expect(event.defaultPrevented).toBe(true)
    expect(inputValue(composer.input)).toBe('@所有人 ')
    expect(services.runCommand).not.toHaveBeenCalled()
  })

  it('moves mention selection with arrow keys before confirming a role', async () => {
    const { composer } = renderComposer({
      state: makeState({
        roles: [
          makeRole('chat-1', 'role-1', '工程师', 'ready'),
          makeRole('chat-1', 'role-2', '产品经理', 'ready'),
        ],
      }),
    })

    await typeText(composer.input, '@')
    const downEvent = pressKey(composer.input, 'ArrowDown')

    expect(downEvent.defaultPrevented).toBe(true)
    expect(composer.panel).not.toBeNull()
    expect(activeMentionName(composer.panel!)).toBe('工程师')

    const upEvent = pressKey(composer.input, 'ArrowUp')

    expect(upEvent.defaultPrevented).toBe(true)
    expect(activeMentionName(composer.panel!)).toBe('所有人')

    pressKey(composer.input, 'ArrowDown')
    pressKey(composer.input, 'Enter')

    await waitFor(() => expect(inputValue(composer.input)).toBe('@工程师（DeepSeek） '))
  })

  it('keeps the panel hidden after Escape until the next input', async () => {
    const { composer } = renderComposer()

    await typeText(composer.input, '@')
    expect(composer.panel).not.toBeNull()

    pressKey(composer.input, 'Escape')
    await waitFor(() => expect(composer.panel).toBeNull())

    // 下一次输入（@ 仍未闭合）重新打开面板
    await typeText(composer.input, '@x')
    expect(composer.panel).not.toBeNull()
  })

  it('does not confirm a mention with Enter while composing with an IME', async () => {
    const { composer, services } = renderComposer()

    await typeText(composer.input, '@')
    const event = pressKey(composer.input, 'Enter', { isComposing: true })

    expect(event.defaultPrevented).toBe(false)
    expect(inputValue(composer.input)).toBe('@')
    expect(services.runCommand).not.toHaveBeenCalled()
  })
})

describe('team page composer targeting', () => {
  it('previews no-mention messages as chat records without requiring ready roles', () => {
    renderComposer({ state: makeState({ roleStatus: 'thinking', requireManualMention: true }) })

    return withDraft('先记录这个背景', () => {
      expect(targetPreviewText()).toBe('将作为群消息记录，不触发 AI；@ 人员可触发回复')
      expect(sendButton().disabled).toBe(false)
    })
  })

  it('previews no-mention collaborative messages as chat records by default', () => {
    renderComposer({ state: makeState({ mode: 'collaborative' }) })

    return withDraft('先记录这个背景', () => {
      expect(targetPreviewText()).toBe('将作为群消息记录，不触发 AI；@ 人员可触发回复')
      expect(sendButton().disabled).toBe(false)
    })
  })

  it('previews no-mention collaborative messages as all-member replies when manual mention routing is off', () => {
    renderComposer({ state: makeState({ mode: 'collaborative', requireManualMention: false }) })

    return withDraft('请一起评估', () => {
      expect(targetPreviewText()).toBe('将发送给：工程师（DeepSeek）')
      expect(sendButton().disabled).toBe(false)
    })
  })

  it('previews the empty draft as record-only guidance in independent mode', () => {
    renderComposer({ state: makeState({ requireManualMention: true }) })

    expect(targetPreviewText()).toBe('输入消息；不 @ 仅记录，@ 人员触发回复')
    expect(sendButton().disabled).toBe(true)
  })

  it('previews the empty draft as all-member guidance when default target is all', () => {
    renderComposer({ state: makeState({ mode: 'collaborative', requireManualMention: false }) })

    expect(targetPreviewText()).toBe('输入消息；不 @ 会让所有成员回复，也可 @ 指定成员')
    expect(sendButton().disabled).toBe(true)
  })

  it('disables sending while a role is reconnecting and no ready target remains', () => {
    const state = makeState({ roleStatus: 'error' })
    state.reconnectingRoleKeys.add('chat-1:role-1')
    renderComposer({ state })

    return withDraft('@all 请回复', () => {
      expect(targetPreviewText()).toBe('正在自动连接：工程师（DeepSeek）')
      expect(sendButton().disabled).toBe(true)
    })
  })

  it('previews partial reconnecting targets alongside ready ones', () => {
    const state = makeState({
      roles: [
        makeRole('chat-1', 'role-1', '工程师', 'ready'),
        makeRole('chat-1', 'role-2', '产品经理', 'ready'),
      ],
    })
    state.reconnectingRoleKeys.add('chat-1:role-2')
    renderComposer({ state })

    return withDraft('@all 请回复', () => {
      expect(targetPreviewText()).toBe('将发送给：工程师（DeepSeek）；正在连接：产品经理（DeepSeek）')
      expect(sendButton().disabled).toBe(false)
    })
  })

  it('blocks sending while a thinking role cannot auto-reconnect', () => {
    // 刚进入 thinking（updatedAt 新鲜）→ 不在超时自动重连范围 → 发送被拦截
    renderComposer({
      state: makeState({ roles: [makeRole('chat-1', 'role-1', '工程师', 'thinking', Date.now())] }),
    })

    return withDraft('@all 请回复', () => {
      expect(targetPreviewText()).toBe('请稍等：工程师（DeepSeek） 正在回复')
      expect(sendButton().disabled).toBe(true)
    })
  })

  it('previews skipping busy roles when ready targets exist', () => {
    renderComposer({
      state: makeState({
        roles: [
          makeRole('chat-1', 'role-1', '工程师', 'ready'),
          makeRole('chat-1', 'role-2', '产品经理', 'thinking', Date.now()),
        ],
      }),
    })

    return withDraft('@all 请回复', () => {
      expect(targetPreviewText()).toBe('将发送给：工程师（DeepSeek）；跳过正在回复：产品经理（DeepSeek）')
      expect(sendButton().disabled).toBe(false)
    })
  })

  it('previews auto-reconnect for unavailable non-thinking roles', () => {
    renderComposer({ state: makeState({ roleStatus: 'error' }) })

    return withDraft('@all 请回复', () => {
      expect(targetPreviewText()).toBe('将先自动连接：工程师（DeepSeek）')
      expect(sendButton().disabled).toBe(false)
    })
  })

  it('shows the busy preview for visible thinking roles', () => {
    // 忙碌预览只统计未超时的 thinking（isThinkingBubbleVisible）
    renderComposer({
      state: makeState({
        roles: [makeRole('chat-1', 'role-1', '工程师', 'thinking', Date.now())],
        requireManualMention: true,
      }),
    })

    expect(busyPreviewText()).toBe('正在回复：工程师（DeepSeek）')
  })

  it('prompts to pick a chat when nothing is selected', () => {
    const state = makeState({})
    state.store.currentChatId = undefined
    state.selectedChatId = undefined
    renderComposer({ state })

    expect(targetPreviewText()).toBe('选择群聊后可发送')
    expect(sendButton().disabled).toBe(true)
  })

  it('prompts to add people when the chat has none', () => {
    const state = makeState({})
    const chat = state.store.chatsById['chat-1']
    chat.roleIds = []
    renderComposer({ state })

    expect(targetPreviewText()).toBe('当前群聊还没有人员')
    expect(sendButton().disabled).toBe(true)
  })
})

describe('team page composer send flow', () => {
  it('submits no-mention messages without reconnecting or blocking on thinking roles', async () => {
    const { services } = renderComposer({ state: makeState({ roleStatus: 'thinking', requireManualMention: true }) })

    await withDraft('先记录这个背景', async () => {
      fireEvent.click(sendButton())

      await waitFor(() => expect(services.runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_SEND', {
        chatId: 'chat-1',
        raw: '先记录这个背景',
        reference: undefined,
      }))
      expect(showError).not.toHaveBeenCalled()
      expect(services.reconnectRolesForSend).not.toHaveBeenCalled()
    })
  })

  it('submits all-member messages when at least one targeted role can receive them', async () => {
    const { services } = renderComposer({
      state: makeState({
        roles: [
          makeRole('chat-1', 'role-1', '工程师', 'ready'),
          makeRole('chat-1', 'role-2', '产品经理', 'thinking', Date.now()),
        ],
      }),
    })

    await withDraft('@all 请一起评估', async () => {
      fireEvent.click(sendButton())

      await waitFor(() => expect(services.runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_SEND', {
        chatId: 'chat-1',
        raw: '@all 请一起评估',
        reference: undefined,
      }))
      expect(showError).not.toHaveBeenCalled()
      expect(services.reconnectRolesForSend).not.toHaveBeenCalled()
    })
  })

  it('clears the draft after a successful send', async () => {
    const { composer } = renderComposer()

    await withDraft('先记录这个背景', async () => {
      fireEvent.click(sendButton())

      await waitFor(() => expect(inputValue(composer.input)).toBe(''))
    })
  })

  it('restores the draft when the send command fails', async () => {
    const { composer, services } = renderComposer()
    vi.mocked(services.runCommand).mockRejectedValueOnce(new Error('发送失败'))

    await withDraft('先记录这个背景', async () => {
      fireEvent.click(sendButton())

      await waitFor(() => expect(showError).toHaveBeenCalledWith('发送失败'))
      expect(inputValue(composer.input)).toBe('先记录这个背景')
    })
  })

  it('treats unresolvable mentions as plain content instead of blocking the send', async () => {
    const { services } = renderComposer()

    await withDraft('@不存在的人 你好', async () => {
      fireEvent.click(sendButton())

      await waitFor(() => expect(services.runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_SEND', {
        chatId: 'chat-1',
        raw: '@不存在的人 你好',
        reference: undefined,
      }))
      expect(showError).not.toHaveBeenCalled()
    })
  })

  it('sends with the selected reference and clears it afterwards', async () => {
    const { state, services } = renderComposer()
    const reference = {
      messageId: 'msg-1',
      roleId: 'role-1',
      roleName: '工程师',
      contentSnapshot: '之前的回复内容',
    }

    act(() => {
      state.selectedReference = reference
      notifyAppState()
    })

    await withDraft('看一下这条', async () => {
      fireEvent.click(sendButton())

      await waitFor(() => expect(services.runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_SEND', {
        chatId: 'chat-1',
        raw: '看一下这条',
        reference,
      }))
      await waitFor(() => expect(state.selectedReference).toBeUndefined())
      expect(document.getElementById('reference-draft')?.hidden).toBe(true)
    })
  })

  it('shows and cancels the reference draft bar', async () => {
    const { state } = renderComposer()

    act(() => {
      state.selectedReference = {
        messageId: 'msg-1',
        roleId: 'role-1',
        roleName: '工程师',
        contentSnapshot: '之前的回复内容',
      }
      notifyAppState()
    })

    const draft = await waitFor(() => {
      const el = document.getElementById('reference-draft')
      if (!el || el.hidden) throw new Error('reference draft not visible')
      return el
    })
    expect(draft.textContent).toContain('引用 工程师：之前的回复内容')

    fireEvent.click(draft.querySelector<HTMLButtonElement>('[aria-label="取消引用"]')!)
    await waitFor(() => expect(state.selectedReference).toBeUndefined())
    expect(document.getElementById('reference-draft')?.hidden).toBe(true)
  })

  it('registers the imperative api on the composer bridge for external callers', async () => {
    const { composer, services, state } = renderComposer()
    const register = vi.mocked(services.composerBridge.register)
    expect(register).toHaveBeenCalled()

    const api = register.mock.calls[register.mock.calls.length - 1]![0]
    const role = makeRole('chat-1', 'role-1', '工程师', 'ready')

    act(() => {
      api.insertMention(role)
    })
    await waitFor(() => expect(inputValue(composer.input)).toBe('@工程师（DeepSeek） '))

    const message = {
      id: 'msg-1',
      chatId: 'chat-1',
      seq: 1,
      type: 'assistant' as const,
      roleId: 'role-1',
      roleName: '工程师',
      content: '之前的回复内容',
      createdAt: 0,
      status: 'received' as const,
    }
    act(() => {
      api.setReference(message)
    })
    await waitFor(() => {
      expect(state.selectedReference?.messageId).toBe('msg-1')
      expect(document.getElementById('reference-draft')?.hidden).toBe(false)
    })
  })
})

describe('team page composer v2 visual', () => {
  it('composer container gains focus ring and small radius', () => {
    renderComposer()

    const form = document.querySelector('#composer')!
    expect(form.className).toContain('rounded-lg')
    expect(form.className).toContain('focus-within:ring-1')
    expect(form.className).toContain('ring-ring')
    expect(form.className).not.toContain('rounded-2xl')
  })

  it('composer form keeps position relative as the mention panel containing block', () => {
    renderComposer()

    const form = document.querySelector('#composer')!
    expect(form.className).toContain('relative')
  })

  it('retires composer id rules from legacy.css while keeping the mention panel family', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/teamPage/ui/styles/legacy.css'), 'utf8')

    expect(css).not.toMatch(/#message-input\s*[,{]/)
    expect(css).not.toContain('#send-message')
    expect(css).not.toContain('#reference-draft')
    expect(css).toMatch(/\.mention-panel\s*[,{]/)
  })

  it('mention button inserts @ and focuses textarea', () => {
    renderComposer()

    fireEvent.click(mentionButton())

    const input = document.querySelector('#message-input') as HTMLTextAreaElement
    expect(input.value).toContain('@')
    expect(document.activeElement).toBe(input)
  })

  it('mention button opens the mention panel', () => {
    renderComposer()

    fireEvent.click(mentionButton())

    expect(document.getElementById('mention-panel')).not.toBeNull()
  })

  it('mention button is disabled without roles', () => {
    const state = makeState({})
    const chat = state.store.chatsById['chat-1']
    chat.roleIds = []
    renderComposer({ state })

    expect(mentionButton().disabled).toBe(true)
  })

  it('textarea grows with content up to max-h', async () => {
    const { composer } = renderComposer()

    // jsdom 无布局：scrollHeight 恒 0 —— mock 成 300px 断言钳到 max-h-40
    Object.defineProperty(composer.input, 'scrollHeight', { value: 300, configurable: true })
    await typeText(composer.input, '很长的一段消息。'.repeat(40))

    expect(composer.input.style.height).toBe('160px')
  })
})

// ---------- 装配与工具 ----------

interface ComposerHarnessOptions {
  state?: ReturnType<typeof makeState>
}

function renderComposer(options: ComposerHarnessOptions = {}) {
  const state = options.state ?? makeState({})
  const renderOptions: RenderWithServicesOptions = { state }
  const utils = renderWithServices(<Composer />, renderOptions)
  const composer = {
    input: document.getElementById('message-input') as HTMLTextAreaElement,
    get panel(): HTMLElement | null {
      return document.getElementById('mention-panel')
    },
  }
  return { ...utils, state, composer }
}

async function withDraft(text: string, run: () => void | Promise<void>): Promise<void> {
  const input = document.getElementById('message-input') as HTMLTextAreaElement | null
  if (text) {
    if (!input) throw new Error('#message-input 未渲染')
    await act(async () => {
      fireEvent.change(input, { target: { value: text } })
    })
  }
  await act(async () => {
    await run()
  })
}

async function typeText(input: HTMLTextAreaElement, text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(input, { target: { value: text } })
  })
}

function inputValue(input: HTMLTextAreaElement): string {
  return input.value
}

function pressKey(target: HTMLElement, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  // act 包裹同步 flush：keydown 处理器里的 setState 立即反映到 DOM
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

function targetPreviewText(): string {
  return document.getElementById('target-preview')?.textContent ?? ''
}

function busyPreviewText(): string {
  return document.getElementById('busy-preview')?.textContent ?? ''
}

function sendButton(): HTMLButtonElement {
  const button = document.getElementById('send-message')
  if (!button) throw new Error('#send-message 未渲染')
  return button as HTMLButtonElement
}

function mentionButton(): HTMLButtonElement {
  const button = document.getElementById('composer-mention')
  if (!button) throw new Error('#composer-mention 未渲染')
  return button as HTMLButtonElement
}

function optionNames(panel: HTMLElement): (string | undefined)[] {
  return [...panel.querySelectorAll('.mention-name')].map(node => node.textContent)
}

function optionBadges(panel: HTMLElement): (string | undefined)[] {
  return [...panel.querySelectorAll('.mention-site-badge')].map(node => node.textContent)
}

function activeMentionName(panel: HTMLElement): string | undefined {
  return panel.querySelector('.mention-option.active .mention-name')?.textContent ?? undefined
}

interface MakeStateOptions {
  roleStatus?: GroupRole['status']
  roles?: GroupRole[]
  mode?: GroupChat['mode']
  requireManualMention?: boolean
}

function makeState(options: MakeStateOptions) {
  const store = createDefaultStore()
  const roles = options.roles ?? [makeRole('chat-1', 'role-1', '工程师', options.roleStatus ?? 'ready')]
  const chat: GroupChat = {
    id: 'chat-1',
    name: '讨论',
    mode: options.mode ?? 'independent',
    roleIds: roles.map(role => role.id),
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    requireManualMention: options.requireManualMention,
    createdAt: 0,
    updatedAt: 0,
  }
  store.currentChatId = chat.id
  store.chatOrder = [chat.id]
  store.chatsById[chat.id] = chat
  for (const role of roles) store.rolesById[role.id] = role

  const state = createTeamPageState()
  state.store = store
  state.selectedChatId = chat.id
  return state
}

function makeRole(chatId: string, id: string, name: string, status: GroupRole['status'], updatedAt = 0): GroupRole {
  return {
    id,
    chatId,
    name,
    systemPrompt: `从${name}角度分析`,
    status,
    contextCursor: 0,
    createdAt: 0,
    updatedAt,
  }
}

beforeEach(() => {
  vi.mocked(showError).mockClear()
})
