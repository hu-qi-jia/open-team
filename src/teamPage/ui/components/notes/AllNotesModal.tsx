import { useEffect, useMemo, useRef, useState } from 'react'
import { useServices } from '../../context/ServicesContext'
import { useStoreSelector } from '../../hooks/useStoreSelector'
import { useT } from '../../hooks/useT'
import { getAppState, getAppStateVersion } from '../../lib/appStore'
import type { NoteEditorFactory } from '../../lib/noteEditor'
import { collectNoteItems, type NoteListItem } from '../../lib/noteItems'
import { showError } from '../../lib/toast'
import { useNoteEditorEngine } from './useNoteEditorEngine'

const TOOLBAR_COMMANDS: Array<{ command: 'bold' | 'italic' | 'strike' | 'bulletList' | 'orderedList'; id: string; label: string; content: React.ReactNode }> = [
  { command: 'bold', id: 'all-note-bold', label: '加粗', content: <b>B</b> },
  { command: 'italic', id: 'all-note-italic', label: '斜体', content: <i>I</i> },
  { command: 'strike', id: 'all-note-strike', label: '删除线', content: <s>S</s> },
  { command: 'bulletList', id: 'all-note-bullet-list', label: '项目列表', content: '•' },
  { command: 'orderedList', id: 'all-note-ordered-list', label: '编号列表', content: '1.' },
]

/*
 * 全部笔记弹窗（原 allNotesView 整体 React 化，P3）。#all-notes-modal
 * 结构与内部 id 原样保留（.modal-backdrop hidden 开合、#all-notes-list、
 * #all-notes-active-title/-meta、#all-notes-editor、#all-note-* 工具栏）。
 * 与原实现的对译关系：
 * - 开启入口：Rail 的 #open-all-notes 点击 → uiBus 'open-all-notes'
 *   （弹窗组件挂载期订阅；关闭时机由本组件 Escape / 遮罩 / 关闭钮处理）；
 * - renderAllNotes 的收集与目标兜底 → items useMemo（version 驱动）+
 *   selectAvailableTarget effect（活跃目标失活时回退当前群聊/首项）；
 * - 切目标前先落保存（saveNow + 脏标记），与原 closeAllNotes/切目标语义一致；
 * - 编辑器机制复用 useNoteEditorEngine（250ms 防抖 + 脏标记，同原
 *   hasUnsavedChanges：无编辑不落保存）。
 */
export function AllNotesModal({ createEditor }: { createEditor?: NoteEditorFactory } = {}) {
  const services = useServices()
  const t = useT()
  const version = useStoreSelector(getAppStateVersion)
  const [open, setOpen] = useState(false)
  const [activeTargetId, setActiveTargetId] = useState<string | undefined>(undefined)
  const editorElementRef = useRef<HTMLDivElement | null>(null)

  const items = useMemo(
    () => (open ? collectNoteItems(getAppState().store) : []),
    [open, version],
  )
  const activeTarget = items.find(item => item.id === activeTargetId)

  const engine = useNoteEditorEngine({
    editorElementRef,
    getTarget: () => {
      if (!open) return undefined
      return activeTarget
        ? { key: activeTarget.id, scope: activeTarget.scope, chatId: activeTarget.chatId, content: activeTarget.content }
        : undefined
    },
    save: (target, content) => {
      services.runCommand('GROUP_NOTE_SAVE', {
        scope: target.scope,
        ...(target.chatId ? { chatId: target.chatId } : {}),
        content,
      }).catch(error => showError(error instanceof Error ? error.message : String(error)))
    },
    showError: message => showError(message),
    createEditor,
    dirtyTracking: true,
  })

  // 原 selectAvailableTarget：活跃目标仍存在则保持，否则回退当前群聊 / 首项
  useEffect(() => {
    if (!open) return
    if (activeTargetId && items.some(item => item.id === activeTargetId)) return
    const currentChatId = getAppState().selectedChatId
    setActiveTargetId((items.find(item => item.chatId === currentChatId) ?? items[0])?.id)
  }, [open, activeTargetId, items])

  // 打开与切目标后同步内容并聚焦（原 registerAllNotesEvents 开钮与
  // renderNoteTargetButton 点击两处 ensureEditor + renderActiveTarget +
  // focusEditorWhenReady；activeTarget 由 activeTargetId 派生，不入依赖）
  useEffect(() => {
    if (!open || !activeTarget) return
    engine.syncTarget()
    engine.focusWhenReady()
  }, [open, activeTargetId])

  useEffect(() => {
    services.uiBus.on('open-all-notes', () => setOpen(true))
  }, [services])

  useEffect(() => () => engine.destroy(), [engine])

  // 原 document keydown Escape 关闭
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeAllNotes()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  function closeAllNotes(): void {
    engine.saveNow()
    setOpen(false)
  }

  function selectTarget(item: NoteListItem): void {
    engine.saveNow()
    setActiveTargetId(item.id)
    engine.focusWhenReady()
  }

  return (
    <div
      id="all-notes-modal"
      className="modal-backdrop"
      hidden={!open}
      onClick={event => {
        if (event.target === event.currentTarget) closeAllNotes()
      }}
    >
      <section className="modal all-notes-modal" role="dialog" aria-modal="true" aria-labelledby="all-notes-title">
        <div className="modal-header">
          <div>
            <h2 id="all-notes-title">{t('全部笔记')}</h2>
            <p className="tiny">{t('全局、群聊、已删除群聊')}</p>
          </div>
          <button id="close-all-notes" className="icon-btn modal-close" type="button" aria-label={t('关闭全部笔记')} onClick={closeAllNotes}>×</button>
        </div>
        <div className="all-notes-workspace">
          <div id="all-notes-list" className="all-notes-list" aria-label={t('笔记范围')}>
            {items.length === 0 ? (
              <div className="all-notes-empty">{t('还没有笔记')}</div>
            ) : items.map(item => (
              <button
                key={item.id}
                type="button"
                className={`all-note-target${item.deletedChat ? ' deleted-chat' : ''}${item.id === activeTargetId ? ' active' : ''}`}
                data-note-target-id={item.id}
                aria-pressed={item.id === activeTargetId}
                onClick={() => selectTarget(item)}
              >
                <span className="all-note-target-title">{t(item.title)}</span>
                <span className="all-note-target-meta">{t(item.meta)}</span>
              </button>
            ))}
          </div>
          <section className="all-notes-editor-shell" aria-labelledby="all-notes-active-title">
            <div className="all-notes-editor-header">
              <div>
                <h3 id="all-notes-active-title">{activeTarget ? t(activeTarget.title) : ''}</h3>
                <p id="all-notes-active-meta" className="tiny">{activeTarget ? t(activeTarget.meta) : ''}</p>
              </div>
            </div>
            <div className="note-toolbar all-note-toolbar">
              {TOOLBAR_COMMANDS.map(({ command, id, label, content }) => (
                <button key={id} id={id} className="note-tool-btn" type="button" aria-label={t(label)} onClick={() => engine.runCommand(command)}>{content}</button>
              ))}
              <span className="note-toolbar-spacer"></span>
              <button id="all-note-undo" className="note-tool-btn" type="button" aria-label={t('撤销')} onClick={() => engine.runCommand('undo')}>↶</button>
              <button id="all-note-redo" className="note-tool-btn" type="button" aria-label={t('重做')} onClick={() => engine.runCommand('redo')}>↷</button>
            </div>
            <div ref={editorElementRef} id="all-notes-editor" className="notes-editor all-notes-editor" aria-label={t('当前笔记富文本编辑器')}></div>
          </section>
        </div>
      </section>
    </div>
  )
}
