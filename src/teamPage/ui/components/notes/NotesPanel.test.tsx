// @vitest-environment jsdom

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../../../../group/store'
import type { GroupChat, OpenTeamStore, RichNoteDocument } from '../../../../group/types'
import { createTeamPageState } from '../../../appState'
import type { NoteEditorAdapter, NoteEditorFactory } from '../../lib/noteEditor'
import { notifyAppState } from '../../lib/appStore'
import { createFakeServices, renderWithServices } from '../../test/TestProviders'
import { NotesPanel } from './NotesPanel'

/*
 * 笔记面板 RTL（notesView.test.ts 重写）。开合 / 范围切换 / 工具栏命令 /
 * 250ms 防抖保存 / 划词插入 / 拖拽与缩放钳制逐条对应；原 #toggle-notes-panel
 * 点击移入 ChatHeader.test.tsx（按钮已 React 化），这里经 appState 翻转驱动。
 */

vi.mock('../../lib/toast', () => ({ showError: vi.fn(), showSuccess: vi.fn() }))

describe('team page notes panel boundary', () => {
  it('keeps notes rendering out of the entrypoint and removes the vanilla view modules', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.tsx'), 'utf8')

    expect(entrySource).not.toContain('createNotesView')
    expect(entrySource).not.toContain('createAllNotesView')
    expect(entrySource).not.toContain('registerNotesEvents')
    expect(entrySource).toContain('notesBridge')
    for (const file of ['notesView.ts', 'notesView.test.ts', 'allNotesView.ts', 'allNotesView.test.ts']) {
      expect(existsSync(resolve(process.cwd(), 'src/teamPage', file))).toBe(false)
    }
  })
})

describe('team page notes panel', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens with the chat note tab active and closes from the close button', async () => {
    const { state } = renderPanel()

    expect(document.querySelector<HTMLElement>('#notes-panel')?.classList.contains('open')).toBe(false)
    expect(document.querySelector('#notes-editor')).toBeTruthy()

    await act(async () => {
      state.notesPanelOpen = true
      notifyAppState()
    })

    const panel = document.querySelector<HTMLElement>('#notes-panel')!
    expect(panel.classList.contains('open')).toBe(true)
    expect(document.querySelector<HTMLElement>('#chat-note-tab')?.classList.contains('active')).toBe(true)
    expect(document.querySelector<HTMLElement>('#global-note-tab')?.classList.contains('active')).toBe(false)
    expect(document.querySelector('#close-notes-panel')?.getAttribute('aria-label')).toBe('关闭笔记')

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#close-notes-panel')!.click()
    })

    expect(panel.classList.contains('open')).toBe(false)
    expect(state.notesPanelOpen).toBe(false)
  })

  it('creates the editor lazily with the active note content and switches scope via the tabs', async () => {
    const { state, creations } = renderPanel()

    await act(async () => {
      state.notesPanelOpen = true
      notifyAppState()
    })
    expect(creations).toHaveLength(1)
    expect(creations[0].element.id).toBe('notes-editor')
    expect(creations[0].content).toEqual(note('群聊笔记'))

    // notifyAppState 走 queueMicrotask 合并，点击后需 await act 让 React 提交
    await act(async () => {
      document.querySelector<HTMLButtonElement>('#global-note-tab')!.click()
    })
    expect(state.activeNoteScope).toBe('global')
    expect(document.querySelector<HTMLElement>('#global-note-tab')?.classList.contains('active')).toBe(true)

    await act(async () => {
      document.querySelector<HTMLButtonElement>('#chat-note-tab')!.click()
    })
    expect(state.activeNoteScope).toBe('chat')
  })

  it('falls back to the global note and disables the chat tab when no chat is selected', async () => {
    const { state } = renderPanel({ withoutChat: true })

    await act(async () => {
      state.notesPanelOpen = true
      notifyAppState()
    })

    expect(document.querySelector<HTMLButtonElement>('#chat-note-tab')?.disabled).toBe(true)
    expect(document.querySelector<HTMLElement>('#global-note-tab')?.classList.contains('active')).toBe(true)
  })

  it('runs toolbar commands through the editor adapter', async () => {
    const { state, editor } = renderPanel()

    await act(async () => {
      state.notesPanelOpen = true
      notifyAppState()
    })

    act(() => {
      document.querySelector<HTMLButtonElement>('#note-bold')!.click()
    })
    expect(editor.runCommand).toHaveBeenLastCalledWith('bold')

    act(() => {
      document.querySelector<HTMLButtonElement>('#note-italic')!.click()
    })
    expect(editor.runCommand).toHaveBeenLastCalledWith('italic')

    act(() => {
      document.querySelector<HTMLButtonElement>('#note-undo')!.click()
    })
    expect(editor.runCommand).toHaveBeenLastCalledWith('undo')
  })

  it('debounces rich text edits into a single GROUP_NOTE_SAVE after 250ms', async () => {
    vi.useFakeTimers()
    const { services, state, editor, triggerUpdate } = renderPanel()

    await act(async () => {
      state.notesPanelOpen = true
      notifyAppState()
    })
    // 内容经创建参数进入编辑器，切换目标前不再 setContent
    expect(editor.setContent).not.toHaveBeenCalled()

    act(() => triggerUpdate())
    act(() => {
      vi.advanceTimersByTime(249)
    })
    expect(services.runCommand).not.toHaveBeenCalledWith('GROUP_NOTE_SAVE', expect.anything())

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(services.runCommand).toHaveBeenCalledWith('GROUP_NOTE_SAVE', {
      scope: 'chat',
      chatId: 'chat-1',
      content: note('已更新'),
    })
  })

  it('coalesces rapid edits into one debounced save', async () => {
    vi.useFakeTimers()
    const { services, state, triggerUpdate } = renderPanel()

    await act(async () => {
      state.notesPanelOpen = true
      notifyAppState()
    })

    act(() => triggerUpdate())
    act(() => {
      vi.advanceTimersByTime(100)
    })
    act(() => triggerUpdate())
    act(() => {
      vi.advanceTimersByTime(250)
    })

    const saves = vi.mocked(services.runCommand).mock.calls.filter(([type]) => type === 'GROUP_NOTE_SAVE')
    expect(saves).toHaveLength(1)
  })

  it('inserts trimmed text from the bridge into the active chat note and saves immediately', async () => {
    const { services, state, editor } = renderPanel()

    const api = bridgeApi(services)
    await act(async () => {
      api.insertTextIntoActiveNote('  重点内容  ')
    })

    expect(state.notesPanelOpen).toBe(true)
    expect(document.querySelector<HTMLElement>('#notes-panel')?.classList.contains('open')).toBe(true)
    await waitFor(() => expect(editor.insertText).toHaveBeenCalledWith('重点内容'))
    expect(editor.insertText).not.toHaveBeenCalledWith(expect.stringContaining('来源'))
    expect(services.runCommand).toHaveBeenCalledWith('GROUP_NOTE_SAVE', {
      scope: 'chat',
      chatId: 'chat-1',
      content: note('已更新'),
    })
  })

  it('ignores blank insertions and keeps the panel closed', async () => {
    const { services, state, editor } = renderPanel()

    const api = bridgeApi(services)
    await act(async () => {
      api.insertTextIntoActiveNote('   ')
    })

    expect(state.notesPanelOpen).toBe(false)
    expect(editor.insertText).not.toHaveBeenCalled()
    expect(services.runCommand).not.toHaveBeenCalled()
  })

  it('lets the note window be dragged without leaving the viewport', async () => {
    const { state } = renderPanel()

    await act(async () => {
      state.notesPanelOpen = true
      notifyAppState()
    })
    const panel = document.querySelector<HTMLElement>('#notes-panel')!
    const handle = document.querySelector<HTMLElement>('#notes-drag-handle')!

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      x: 420,
      y: 80,
      left: 420,
      top: 80,
      right: 860,
      bottom: 680,
      width: 440,
      height: 600,
      toJSON: () => ({}),
    } as DOMRect)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 })

    act(() => {
      handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 440, clientY: 100, pointerId: 1 }))
    })
    expect(panel.classList.contains('dragging')).toBe(true)

    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', { clientX: 540, clientY: 170, pointerId: 1 }))
    })
    act(() => {
      window.dispatchEvent(pointerEvent('pointerup', { clientX: 540, clientY: 170, pointerId: 1 }))
    })

    expect(panel.style.left).toBe('448px')
    expect(panel.style.top).toBe('148px')
    expect(panel.style.right).toBe('auto')
    expect(panel.classList.contains('dragging')).toBe(false)
  })

  it('lets the note window be resized without exceeding the viewport', async () => {
    const { state } = renderPanel()

    await act(async () => {
      state.notesPanelOpen = true
      notifyAppState()
    })
    const panel = document.querySelector<HTMLElement>('#notes-panel')!
    const handle = document.querySelector<HTMLButtonElement>('#notes-resize-handle')!

    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({
      x: 420,
      y: 80,
      left: 420,
      top: 80,
      right: 860,
      bottom: 680,
      width: 440,
      height: 600,
      toJSON: () => ({}),
    } as DOMRect)
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 760 })

    act(() => {
      handle.dispatchEvent(pointerEvent('pointerdown', { clientX: 860, clientY: 680, pointerId: 2 }))
    })
    expect(panel.classList.contains('resizing')).toBe(true)

    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', { clientX: 1060, clientY: 900, pointerId: 2 }))
    })
    act(() => {
      window.dispatchEvent(pointerEvent('pointerup', { clientX: 1060, clientY: 900, pointerId: 2 }))
    })

    expect(panel.style.width).toBe('468px')
    expect(panel.style.height).toBe('668px')
    expect(panel.classList.contains('resizing')).toBe(false)
  })
})

// ---------- 装配与工具 ----------

interface RenderPanelOptions {
  withoutChat?: boolean
}

function renderPanel(options: RenderPanelOptions = {}) {
  const state = makeState(options)
  const creations: Array<{ element: HTMLElement; content: RichNoteDocument }> = []
  let onUpdate: (() => void) | undefined
  const editor = makeEditor()
  const createEditor: NoteEditorFactory = creationOptions => {
    onUpdate = creationOptions.onUpdate
    creations.push({ element: creationOptions.element, content: creationOptions.content })
    return editor
  }
  const services = createFakeServices()
  const utils = renderWithServices(<NotesPanel createEditor={createEditor} />, { services, state })
  return { ...utils, state, editor, creations, triggerUpdate: () => onUpdate?.() }
}

function makeState(options: RenderPanelOptions) {
  const store: OpenTeamStore = createDefaultStore()
  store.settings.language = 'zh-CN'
  store.globalNote = note('全局记录')
  const chat: GroupChat = {
    id: 'chat-1',
    name: '产品会',
    mode: 'independent',
    roleIds: [],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
  if (!options.withoutChat) {
    store.currentChatId = chat.id
    store.chatOrder = [chat.id]
    store.chatsById[chat.id] = chat
    store.chatNotesById = { [chat.id]: note('群聊笔记') }
  }

  const state = createTeamPageState()
  state.store = store
  state.selectedChatId = options.withoutChat ? undefined : chat.id
  return state
}

function bridgeApi(services: ReturnType<typeof createFakeServices>): { insertTextIntoActiveNote(text: string): void } {
  const register = vi.mocked(services.notesBridge.register)
  expect(register).toHaveBeenCalled()
  return register.mock.calls[0][0]
}

function makeEditor(): NoteEditorAdapter {
  return {
    setContent: vi.fn(),
    getJSON: vi.fn(() => note('已更新')),
    insertText: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(),
    runCommand: vi.fn(),
  }
}

function pointerEvent(type: string, options: { clientX: number; clientY: number; pointerId: number }): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, clientX: options.clientX, clientY: options.clientY, button: 0 }) as PointerEvent
  Object.defineProperty(event, 'pointerId', { value: options.pointerId })
  return event
}

function note(text: string): RichNoteDocument {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}
