// @vitest-environment jsdom

import { act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

    expect(document.querySelector('#all-notes-modal')).not.toBeNull()
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
    const { services, triggerUpdate } = renderModal()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    act(() => triggerUpdate())
    act(() => {
      document.querySelector<HTMLButtonElement>('#close-all-notes')!.click()
    })

    await waitFor(() => expect(document.querySelector('#all-notes-modal')).toBeNull())
    expect(services.runCommand).toHaveBeenCalledWith('GROUP_NOTE_SAVE', {
      scope: 'chat',
      chatId: 'chat-1',
      content: note('已编辑'),
    })
  })

  it('closes on Escape and on overlay clicks without saving clean notes', async () => {
    const { services } = renderModal()
    const user = userEvent.setup()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await waitFor(() => expect(document.querySelector('#all-notes-modal')).toBeNull())
    expect(services.runCommand).not.toHaveBeenCalled()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })
    // Radix Dialog deferPointerDownOutside：主键 pointerdown 登记、后续
    // click 才触发关闭——用 userEvent 走完整指针事件序列（等价真实点击）
    await user.click(document.querySelector('[data-slot="dialog-overlay"]')!)
    await waitFor(() => expect(document.querySelector('#all-notes-modal')).toBeNull())

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })
    act(() => {
      document.querySelector<HTMLElement>('.all-notes-modal')!.click()
    })
    expect(document.querySelector('#all-notes-modal')).not.toBeNull()
    expect(services.runCommand).not.toHaveBeenCalled()
  })

  /*
   * 壳契约（S5 / T2）：弹窗迁到 common/AppModal 后，宽度/高度令牌、自绘关闭钮
   * 的形状、footer 的条件渲染、正文行的内边距与「唯一滚动容器」都必须由壳的
   * utilities 承担——这些属性 jsdom 不算布局，只能钉类名（与 S4 各迁移用例同口径）。
   */
  it('renders through the shared AppModal shell: 2xl width token, fixed height, svg close, no footer', async () => {
    const { services } = renderModal()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    const modal = document.querySelector<HTMLElement>('#all-notes-modal')!
    // 宽度令牌 2xl（1160）与定高 760：原 .all-notes-modal 的 980 / max-height
    // 由壳的 utilities 接管（legacy 层压不过 utilities 层）
    expect(modal.classList.contains('w-[min(1160px,calc(100vw-48px))]')).toBe(true)
    expect(modal.classList.contains('h-[min(760px,calc(100vh-48px))]')).toBe(true)
    expect(modal.classList.contains('w-[min(980px,calc(100vw-48px))]')).toBe(false)

    // 关闭钮：壳渲染的 svg 图标，不再是裸 `×` 文本节点
    const close = document.querySelector<HTMLElement>('#close-all-notes')
    expect(close).not.toBeNull()
    expect(close!.querySelector('svg')).not.toBeNull()
    expect(close!.textContent).not.toContain('×')
    expect(close!.getAttribute('aria-label')).toBe('关闭全部笔记')

    // 无 footer：壳条件渲染，多一个空节点都会让正文行的定位断言集体误红
    expect(modal.querySelector('[data-slot="modal-footer"]')).toBeNull()

    // 正文行：p-6 补回壳用 p-0 收掉的原语内边距（本弹窗自身不带 padding）；
    // overflow-hidden 抵掉 height="fixed" 给的 overflow-auto——整壳唯一的滚动
    // 容器必须是左栏 #all-notes-list（否则双滚动条）
    const bodyRow = modal.querySelector<HTMLElement>(':scope > [data-slot="modal-body"]')!
    expect(bodyRow.classList.contains('p-6')).toBe(true)
    expect(bodyRow.classList.contains('overflow-hidden')).toBe(true)
    expect(bodyRow.classList.contains('overflow-auto')).toBe(false)
  })

  it('keeps the two-column workspace and the <=760px single-column fallback as utilities', async () => {
    const { services } = renderModal()

    await act(async () => {
      services.uiBus.emit('open-all-notes')
    })

    const workspace = document.querySelector<HTMLElement>('.all-notes-workspace')!
    expect(workspace.classList.contains('grid-cols-[240px_minmax(0,1fr)]')).toBe(true)
    expect(workspace.classList.contains('max-[760px]:grid-cols-1')).toBe(true)

    const list = document.querySelector<HTMLElement>('#all-notes-list')!
    expect(list.getAttribute('aria-label')).toBe('笔记范围')
    expect(list.classList.contains('overflow-auto')).toBe(true)
    expect(list.classList.contains('border-r')).toBe(true)
    expect(list.classList.contains('max-[760px]:flex')).toBe(true)
    expect(list.classList.contains('max-[760px]:overflow-x-auto')).toBe(true)
    expect(list.classList.contains('max-[760px]:border-r-0')).toBe(true)

    // 单栏断点下条目退化成横向卡片：min-width 160 是「列表横向可滚」的支点
    const target = document.querySelector<HTMLElement>('[data-note-target-id="global"]')!
    expect(target.classList.contains('max-[760px]:min-w-[160px]')).toBe(true)
    expect(target.classList.contains('deleted-chat')).toBe(false)

    // 右栏三行栅格：编辑器行吸收剩余高度
    const editorShell = document.querySelector<HTMLElement>('.all-notes-editor-shell')!
    expect(editorShell.classList.contains('grid-rows-[auto_auto_minmax(0,1fr)]')).toBe(true)
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
