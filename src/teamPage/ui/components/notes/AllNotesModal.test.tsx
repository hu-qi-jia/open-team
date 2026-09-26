// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import type { GroupChat, OpenTeamStore, RichNoteDocument } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import type { NoteEditorAdapter, NoteEditorFactory } from '../../lib/noteEditor'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { AllNotesModal } from './AllNotesModal'

/*
 * 全部笔记弹窗 RTL（allNotesView.test.ts 重写）。Rail 开启（uiBus 命令）、
 * 默认目标选择、目标切换的先存后切、已删除群聊笔记可编辑、关闭路径
 * （按钮 / Escape / 遮罩）逐条对应；collectNoteItems 纯函数在
 * noteItems.test.ts。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

describe('team page all notes modal', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens from the rail note command and edits the current chat note by default', async () => {
    const { services, editor } = renderModal()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    expect(document.querySelector<HTMLElement>('#all-notes-modal')?.hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('[data-note-target-id="chat-1"]')?.classList.contains('active')).toBe(true)
    expect(document.querySelector('#all-notes-active-title')?.textContent).toBe('当前群')
    expect(document.querySelector('#all-notes-active-meta')?.textContent).toBe('群聊笔记')
    expect(editor.setContent).not.toHaveBeenCalled()
    await waitFor(() => expect(editor.focus).toHaveBeenCalled())
  })

  it('renders global note labels in English mode', async () => {
    // 无选中群聊时默认目标回落到全局项，才能断言全局标签的英文文案
    const store: OpenTeamStore = createDefaultStore()
    store.globalNote = note('全局记录')
    const state = createTeamPageState()
    state.store = store

    const { services } = renderModal({ state, language: 'en' })

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    expect(document.querySelector('#all-notes-active-title')?.textContent).toBe('Global notes')
    expect(document.querySelector('#all-notes-active-meta')?.textContent).toBe('Manual note')
    expect(document.querySelector('#all-notes-list')?.textContent).not.toContain('全局笔记')
  })

  it('switches note targets and saves rich text edits to the selected chat note', async () => {
    vi.useFakeTimers()
    const { services, editor, triggerUpdate } = renderModal()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-note-target-id="global"]')!.click()
    })
    expect(document.querySelector<HTMLElement>('[data-note-target-id="global"]')?.classList.contains('active')).toBe(true)
    expect(editor.setContent).toHaveBeenLastCalledWith(note('全局记录'))

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-note-target-id="chat-1"]')!.click()
    })
    expect(editor.setContent).toHaveBeenLastCalledWith(note('当前群笔记'))

    act(() => triggerUpdate())
    act(() => {
      vi.advanceTimersByTime(250)
    })

    expect(services.runCommand).toHaveBeenCalledWith('GROUP_NOTE_SAVE', {
      scope: 'chat',
      chatId: 'chat-1',
      content: note('已编辑'),
    })
  })

  it('saves the previous target before switching when it has unsaved edits', async () => {
    vi.useFakeTimers()
    const { services, triggerUpdate } = renderModal()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    act(() => triggerUpdate())
    act(() => {
      vi.advanceTimersByTime(100)
    })
    act(() => {
      document.querySelector<HTMLButtonElement>('[data-note-target-id="global"]')!.click()
    })

    expect(services.runCommand).toHaveBeenCalledWith('GROUP_NOTE_SAVE', {
      scope: 'chat',
      chatId: 'chat-1',
      content: note('已编辑'),
    })
    act(() => {
      vi.advanceTimersByTime(400)
    })
    const saves = vi.mocked(services.runCommand).mock.calls.filter(([type]) => type === 'GROUP_NOTE_SAVE')
    expect(saves).toHaveLength(1)
  })

  it('keeps deleted chat notes editable from the notebook sidebar', async () => {
    const store: OpenTeamStore = createDefaultStore()
    store.settings.language = 'zh-CN'
    store.chatNotesById = { 'deleted-chat': note('这条笔记不能随着群聊消失') }
    const state = createTeamPageState()
    state.store = store

    const { services, editor } = renderModal({ state })

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    // 默认目标回落到全局（无当前群聊）
    expect(document.querySelector<HTMLElement>('[data-note-target-id="global"]')?.classList.contains('active')).toBe(true)

    act(() => {
      document.querySelector<HTMLButtonElement>('[data-note-target-id="deleted-chat"]')!.click()
    })

    expect(document.querySelector('.all-note-target.deleted-chat')).not.toBeNull()
    expect(editor.setContent).toHaveBeenLastCalledWith(note('这条笔记不能随着群聊消失'))
    expect(document.querySelector('#all-notes-active-title')?.textContent).toContain('已删除群聊')
  })

  it('saves unsaved edits and hides the modal from the close button', async () => {
    vi.useFakeTimers()
    const { services, triggerUpdate } = renderModal()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    act(() => triggerUpdate())
    act(() => {
      document.querySelector<HTMLButtonElement>('#close-all-notes')!.click()
    })

    expect(document.querySelector<HTMLElement>('#all-notes-modal')?.hidden).toBe(true)
    expect(services.runCommand).toHaveBeenCalledWith('GROUP_NOTE_SAVE', {
      scope: 'chat',
      chatId: 'chat-1',
      content: note('已编辑'),
    })
  })

  it('closes on Escape and on backdrop clicks without saving clean notes', async () => {
    const { services } = renderModal()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(document.querySelector<HTMLElement>('#all-notes-modal')?.hidden).toBe(true)
    expect(services.runCommand).not.toHaveBeenCalled()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })
    act(() => {
      document.querySelector<HTMLElement>('#all-notes-modal')!.click()
    })
    expect(document.querySelector<HTMLElement>('#all-notes-modal')?.hidden).toBe(true)

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })
    act(() => {
      document.querySelector<HTMLElement>('.all-notes-modal')!.click()
    })
    expect(document.querySelector<HTMLElement>('#all-notes-modal')?.hidden).toBe(false)
    expect(services.runCommand).not.toHaveBeenCalled()
  })
})

// ---------- 装配与工具 ----------

interface RenderModalOptions {
  language?: 'en' | 'zh-CN'
  state?: ReturnType<typeof createTeamPageState>
}

function renderModal(options: RenderModalOptions = {}) {
  const state = options.state ?? makeState()
  const creations: Array<{ element: HTMLElement; content: RichNoteDocument }> = []
  let onUpdate: (() => void) | undefined
  const editor = makeEditor()
  const createEditor: NoteEditorFactory = creationOptions => {
    onUpdate = creationOptions.onUpdate
    creations.push({ element: creationOptions.element, content: creationOptions.content })
    return editor
  }
  const services = createFakeServices()
  const utils = renderWithServices(<AllNotesModal createEditor={createEditor} />, { services, state, language: options.language })
  return { ...utils, state, editor, creations, triggerUpdate: () => onUpdate?.() }
}

function makeState() {
  const chat: GroupChat = {
    id: 'chat-1',
    name: '当前群',
    mode: 'independent',
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
  const store: OpenTeamStore = createDefaultStore()
  store.settings.language = 'zh-CN'
  store.currentChatId = chat.id
  store.chatOrder = [chat.id]
  store.chatsById[chat.id] = chat
  store.globalNote = note('全局记录')
  store.chatNotesById = { [chat.id]: note('当前群笔记') }

  const state = createTeamPageState()
  state.store = store
  state.selectedChatId = chat.id
  return state
}

function makeEditor(): NoteEditorAdapter {
  return {
    setContent: vi.fn(),
    getJSON: vi.fn(() => note('已编辑')),
    insertText: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(),
    runCommand: vi.fn(),
  }
}

function note(text: string): RichNoteDocument {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
