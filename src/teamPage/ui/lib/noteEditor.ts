import type { RichNoteDocument } from '../../../group/types'

/*
 * 笔记富文本编辑器的命令式契约（原 notesView.ts 头部类型迁出）。
 * TipTap 保持命令式模块（tiptapNoteEditor.ts），React 组件只经 adapter
 * 操作编辑器；实例在组件内以 ref 持有、不进 state，编辑器按键产生的
 * onUpdate 走防抖保存，不触发重渲。
 */

export type NoteScope = 'global' | 'chat'

export type NoteToolbarCommand = 'bold' | 'italic' | 'strike' | 'bulletList' | 'orderedList' | 'undo' | 'redo'

export interface NoteEditorAdapter {
  setContent(content: RichNoteDocument): void
  getJSON(): RichNoteDocument
  insertText(text: string): void
  focus(): void
  destroy(): void
  runCommand(command: NoteToolbarCommand): void
}

export type NoteEditorFactory = (options: { element: HTMLElement; content: RichNoteDocument; onUpdate(): void }) => NoteEditorAdapter | Promise<NoteEditorAdapter>

/** 懒加载 TipTap（原 notesView / allNotesView 尾部的动态 import 对译） */
export async function loadTiptapNoteEditor(options: { element: HTMLElement; content: RichNoteDocument; onUpdate(): void }): Promise<NoteEditorAdapter> {
  const module = await import('../../tiptapNoteEditor')
  return module.createTiptapNoteEditor(options)
}
