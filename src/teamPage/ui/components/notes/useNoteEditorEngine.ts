import { useMemo, useRef, type RefObject } from 'react'
import type { RichNoteDocument } from '../../../../group/types'
import {
  loadTiptapNoteEditor,
  type NoteEditorAdapter,
  type NoteEditorFactory,
  type NoteScope,
  type NoteToolbarCommand,
} from '../../lib/noteEditor'

export interface NoteEditorTarget {
  /** 内容键：目标切换时据此 setContent（原 loadedScope/loadedChatId、loadedTargetId） */
  key: string
  scope: NoteScope
  chatId?: string
  content: RichNoteDocument
}

export interface NoteEditorEngineOptions {
  /** TipTap 挂载容器（#notes-editor / #all-notes-editor），恒存于 DOM */
  editorElementRef: RefObject<HTMLElement | null>
  /** 当前目标；undefined 时编辑器保持空闲（不创建、不保存） */
  getTarget(): NoteEditorTarget | undefined
  /** 保存出口：GROUP_NOTE_SAVE 的组装留在组件，engine 只递目标与内容 */
  save(target: { scope: NoteScope; chatId?: string }, content: RichNoteDocument): void
  showError(message: string): void
  /** 测试注入口；生产用 loadTiptapNoteEditor 懒加载 */
  createEditor?: NoteEditorFactory
  /** 脏标记（原 allNotesView.hasUnsavedChanges）：开启后无编辑不落保存 */
  dirtyTracking?: boolean
}

export interface NoteEditorEngine {
  ensureEditor(): Promise<NoteEditorAdapter> | undefined
  /** 目标变化时同步内容（原 renderNotes / renderActiveTarget 的 setContent 分支） */
  syncTarget(): void
  runCommand(command: NoteToolbarCommand): void
  /** 立即保存；同时清掉挂起的防抖计时器（原 saveActiveNote） */
  saveNow(): void
  /** 250ms 防抖保存（原 scheduleSaveActiveNote；编辑器 onUpdate 直连） */
  scheduleSave(): void
  /** 就绪后插入文本并立即保存（原 insertTextIntoActiveNote 内核） */
  insertTextAndSave(text: string): void
  /** 编辑器就绪后聚焦（原 focusEditorWhenReady） */
  focusWhenReady(): void
  destroy(): void
}

const NOTE_SAVE_DEBOUNCE_MS = 250

/*
 * 笔记编辑器引擎：懒创建 + 目标内容同步 + 防抖保存，notesView 与
 * allNotesView 的公共机制收敛于此。与原实现对译的关键差异只有一条：
 * 编辑器实例与加载 promise 挂 ref 而非闭包变量——方法体经 optionsRef
 * 读取最新 options，重渲不重建引擎（返回对象身份稳定）。
 * 全部方法只允许在事件处理器与 effect 中调用；onUpdate（编辑器按键）
 * 直连 scheduleSave，不经过 React 状态。
 */
export function useNoteEditorEngine(options: NoteEditorEngineOptions): NoteEditorEngine {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const adapterRef = useRef<NoteEditorAdapter | undefined>(undefined)
  const loadPromiseRef = useRef<Promise<NoteEditorAdapter> | undefined>(undefined)
  const loadedKeyRef = useRef<string | undefined>(undefined)
  const saveTimerRef = useRef<number | undefined>(undefined)
  const dirtyRef = useRef(false)

  function scheduleSave(): void {
    if (optionsRef.current.dirtyTracking) dirtyRef.current = true
    if (saveTimerRef.current !== undefined) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = undefined
      saveNow()
    }, NOTE_SAVE_DEBOUNCE_MS)
  }

  function saveNow(): void {
    const { save, dirtyTracking, getTarget } = optionsRef.current
    const adapter = adapterRef.current
    if (saveTimerRef.current !== undefined) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = undefined
    }
    if (!adapter) return
    const target = getTarget()
    if (!target) return
    if (dirtyTracking && !dirtyRef.current) return
    if (dirtyTracking) dirtyRef.current = false
    save({ scope: target.scope, chatId: target.chatId }, adapter.getJSON())
  }

  function ensureEditor(): Promise<NoteEditorAdapter> | undefined {
    if (adapterRef.current) return Promise.resolve(adapterRef.current)
    if (loadPromiseRef.current) return loadPromiseRef.current
    const element = optionsRef.current.editorElementRef.current
    const target = optionsRef.current.getTarget()
    if (!element || !target) return undefined
    const created = (optionsRef.current.createEditor ?? loadTiptapNoteEditor)({
      element,
      content: target.content,
      onUpdate: scheduleSave,
    })
    if (!isPromise(created)) {
      adapterRef.current = created
      loadedKeyRef.current = target.key
      return Promise.resolve(created)
    }
    loadPromiseRef.current = created
      .then(adapter => {
        adapterRef.current = adapter
        loadPromiseRef.current = undefined
        syncTarget()
        return adapter
      })
      .catch(error => {
        loadPromiseRef.current = undefined
        optionsRef.current.showError(error instanceof Error ? error.message : String(error))
        throw error
      })
    return loadPromiseRef.current
  }

  function syncTarget(): void {
    const adapter = adapterRef.current
    const target = optionsRef.current.getTarget()
    if (!adapter || !target) return
    if (loadedKeyRef.current === target.key) return
    loadedKeyRef.current = target.key
    adapter.setContent(target.content)
  }

  return useMemo(() => ({
    ensureEditor,
    syncTarget,
    runCommand(command: NoteToolbarCommand): void {
      adapterRef.current?.runCommand(command)
    },
    saveNow,
    scheduleSave,
    insertTextAndSave(text: string): void {
      const adapter = adapterRef.current
      if (adapter) {
        adapter.insertText(text)
        saveNow()
        return
      }
      ensureEditor()?.then(created => {
        created.insertText(text)
        saveNow()
      }).catch(() => undefined)
    },
    focusWhenReady(): void {
      const adapter = adapterRef.current
      if (adapter) {
        adapter.focus()
        return
      }
      ensureEditor()?.then(created => created.focus()).catch(() => undefined)
    },
    destroy(): void {
      if (saveTimerRef.current !== undefined) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = undefined
      }
      adapterRef.current?.destroy()
      adapterRef.current = undefined
      loadPromiseRef.current = undefined
      loadedKeyRef.current = undefined
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [])
}

function isPromise(value: NoteEditorAdapter | Promise<NoteEditorAdapter>): value is Promise<NoteEditorAdapter> {
  return typeof (value as Promise<NoteEditorAdapter>).then === 'function'
}
